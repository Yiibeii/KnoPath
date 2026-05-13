from unittest.mock import Mock, patch

import file_watcher


def test_init_file_watcher_skips_empty_storage_path():
    callback = Mock()

    with patch("file_watcher.os.makedirs") as makedirs:
        watcher = file_watcher.init_file_watcher("", callback)

    assert watcher is None
    makedirs.assert_not_called()
    assert file_watcher.get_file_watcher() is None


def test_reconfigure_file_watcher_can_start_after_empty_initial_path():
    callback = Mock()

    file_watcher.init_file_watcher("", callback)

    with patch("file_watcher.FileWatcher") as watcher_cls:
        watcher = watcher_cls.return_value
        result = file_watcher.reconfigure_file_watcher("C:\\repo")

    assert result is watcher
    watcher_cls.assert_called_once_with("C:\\repo")
    watcher.start.assert_called_once_with(callback)
