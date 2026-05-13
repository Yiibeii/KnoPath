import os
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent
from logger import get_logger
from typing import Callable, Optional
import threading
import time

logger = get_logger('file_watcher')

_COOLDOWN_SECONDS = 3.0


class MarkdownFileHandler(FileSystemEventHandler):
    def __init__(self, callback: Callable[[str, str], None], storage_path: str):
        self.callback = callback
        self.storage_path = storage_path
        self._ignored_paths: set[str] = set()
        self._cooldown_paths: dict[str, float] = {}
        self._cooldown_lock = threading.Lock()
        self._ready = False
        self._ready_event = threading.Event()
        self._paused = False
        self._paused_lock = threading.Lock()
        super().__init__()

    def _get_relative_path(self, path: str) -> str:
        return os.path.normpath(os.path.relpath(path, self.storage_path)).lower()

    def ignore_existing_files(self, paths: list[str]):
        normalized = set()
        for p in paths:
            if p.endswith('.md'):
                normalized.add(self._get_relative_path(p))
        self._ignored_paths = normalized
        logger.info(f"File watcher ignoring {len(self._ignored_paths)} existing .md files")

    def wait_until_ready(self, timeout: float = 10.0) -> bool:
        return self._ready_event.wait(timeout)

    def add_cooldown(self, path: str):
        with self._cooldown_lock:
            self._cooldown_paths[os.path.normpath(path).lower()] = time.monotonic()

    def add_cooldown_batch(self, paths: list[str]):
        now = time.monotonic()
        with self._cooldown_lock:
            for p in paths:
                self._cooldown_paths[os.path.normpath(p).lower()] = now

    def _is_in_cooldown(self, path: str) -> bool:
        with self._cooldown_lock:
            norm = os.path.normpath(path).lower()
            expire_time = self._cooldown_paths.get(norm)
            if expire_time is None:
                return False
            if time.monotonic() - expire_time > _COOLDOWN_SECONDS:
                del self._cooldown_paths[norm]
                return False
            return True

    def _is_ignored(self, path: str) -> bool:
        if not self._ready:
            return True
        rel_path = self._get_relative_path(path)
        return rel_path in self._ignored_paths

    def _mark_processed(self, path: str):
        rel_path = self._get_relative_path(path)
        self._ignored_paths.discard(rel_path)

    def _is_paused(self) -> bool:
        with self._paused_lock:
            return self._paused

    def pause(self):
        with self._paused_lock:
            self._paused = True

    def resume(self):
        with self._paused_lock:
            self._paused = False

    def on_created(self, event: FileSystemEvent):
        if event.is_directory:
            return
        if not event.src_path.endswith('.md'):
            return
        if self._is_paused():
            logger.debug(f"Ignoring paused file created event: {event.src_path}")
            return
        if self._is_ignored(event.src_path):
            logger.debug(f"Ignoring existing file created event: {event.src_path}")
            return
        if self._is_in_cooldown(event.src_path):
            logger.debug(f"Ignoring cooldown file created event: {event.src_path}")
            return
        logger.info(f"File created: {event.src_path}")
        self.callback(event.src_path, 'created')

    def on_modified(self, event: FileSystemEvent):
        if event.is_directory:
            return
        if not event.src_path.endswith('.md'):
            return
        if self._is_paused():
            logger.debug(f"Ignoring paused file modified event: {event.src_path}")
            return
        if self._is_ignored(event.src_path):
            self._mark_processed(event.src_path)
            logger.debug(f"Ignored existing file modified: {event.src_path}")
            return
        if self._is_in_cooldown(event.src_path):
            logger.debug(f"Ignoring cooldown file modified event: {event.src_path}")
            return
        logger.info(f"File modified: {event.src_path}")
        self.callback(event.src_path, 'modified')

    def on_deleted(self, event: FileSystemEvent):
        if event.is_directory:
            return
        if not event.src_path.endswith('.md'):
            return
        if self._is_paused():
            logger.debug(f"Ignoring paused file deleted event: {event.src_path}")
            return
        if self._is_in_cooldown(event.src_path):
            logger.debug(f"Ignoring cooldown file deleted event: {event.src_path}")
            return
        logger.info(f"File deleted: {event.src_path}")
        self.callback(event.src_path, 'deleted')

    def on_moved(self, event: FileSystemEvent):
        if event.is_directory:
            return
        if self._is_paused():
            return
        if event.src_path.endswith('.md'):
            if not self._is_in_cooldown(event.src_path):
                logger.info(f"File moved from: {event.src_path}")
                self.callback(event.src_path, 'deleted')
        if event.dest_path.endswith('.md'):
            if self._is_ignored(event.dest_path):
                logger.debug(f"Ignoring existing file moved to: {event.dest_path}")
                return
            if self._is_in_cooldown(event.dest_path):
                logger.debug(f"Ignoring cooldown file moved to: {event.dest_path}")
                return
            logger.info(f"File moved to: {event.dest_path}")
            self.callback(event.dest_path, 'created')


class FileWatcher:
    def __init__(self, storage_path: str):
        self.storage_path = storage_path
        self.observer = Observer()
        self.event_handler: Optional[MarkdownFileHandler] = None
        self.is_running = False
        self._lock = threading.Lock()
        self._paused = False
        self._paused_lock = threading.Lock()

    def start(self, callback: Callable[[str, str], None]):
        with self._lock:
            if self.is_running:
                logger.warning("File watcher is already running")
                return

            if not os.path.exists(self.storage_path):
                logger.warning(f"Storage path does not exist: {self.storage_path}")
                os.makedirs(self.storage_path, exist_ok=True)

            self.event_handler = MarkdownFileHandler(callback, self.storage_path)

            raw_path = os.path.join(self.storage_path, 'raw')
            wiki_path = os.path.join(self.storage_path, 'wiki')

            existing_files: list[str] = []
            for watch_path in [raw_path, wiki_path]:
                if os.path.exists(watch_path):
                    for root, _, files in os.walk(watch_path):
                        for f in files:
                            if f.endswith('.md'):
                                existing_files.append(os.path.join(root, f))

            self.event_handler.ignore_existing_files(existing_files)

            if os.path.exists(raw_path):
                self.observer.schedule(self.event_handler, raw_path, recursive=True)
                logger.info(f"Watching raw directory: {raw_path}")
            if os.path.exists(wiki_path):
                self.observer.schedule(self.event_handler, wiki_path, recursive=True)
                logger.info(f"Watching wiki directory: {wiki_path}")

            self.observer.start()
            self.is_running = True

            def delayed_ready():
                time.sleep(1)
                if self.event_handler:
                    self.event_handler._ready = True
                    self.event_handler._ready_event.set()
                    logger.info("File watcher ready")

            threading.Thread(target=delayed_ready, daemon=True).start()

    def stop(self):
        with self._lock:
            if not self.is_running:
                return
            self.observer.stop()
            self.observer.join()
            self.is_running = False
            logger.info("File watcher stopped")

    def add_watch_path(self, path: str):
        with self._lock:
            if not self.is_running or not self.event_handler:
                return
            if os.path.exists(path):
                self.observer.schedule(self.event_handler, path, recursive=True)
                logger.info(f"Added watch path: {path}")

    def add_cooldown(self, path: str):
        if self.event_handler:
            self.event_handler.add_cooldown(path)

    def add_cooldown_batch(self, paths: list[str]):
        if self.event_handler:
            self.event_handler.add_cooldown_batch(paths)

    def pause(self):
        with self._paused_lock:
            self._paused = True
        if self.event_handler:
            self.event_handler.pause()
        logger.debug("File watcher paused")

    def resume(self):
        with self._paused_lock:
            self._paused = False
        if self.event_handler:
            self.event_handler.resume()
        logger.debug("File watcher resumed")

    @property
    def is_paused(self) -> bool:
        with self._paused_lock:
            return self._paused


_file_watcher: Optional[FileWatcher] = None
_file_watcher_callback: Optional[Callable[[str, str], None]] = None


def get_file_watcher() -> Optional[FileWatcher]:
    return _file_watcher


def init_file_watcher(storage_path: str, callback: Callable[[str, str], None]) -> Optional[FileWatcher]:
    global _file_watcher, _file_watcher_callback
    _file_watcher_callback = callback
    if not storage_path:
        logger.info("File watcher not started because repository root is not configured")
        _file_watcher = None
        return None
    _file_watcher = FileWatcher(storage_path)
    _file_watcher.start(callback)
    return _file_watcher


def reconfigure_file_watcher(storage_path: str) -> Optional[FileWatcher]:
    global _file_watcher
    if not _file_watcher_callback:
        return None
    if _file_watcher:
        _file_watcher.stop()
    if not storage_path:
        logger.info("File watcher not started because repository root is not configured")
        _file_watcher = None
        return None
    _file_watcher = FileWatcher(storage_path)
    _file_watcher.start(_file_watcher_callback)
    return _file_watcher
