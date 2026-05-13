import config


def test_empty_repository_root_stays_unconfigured():
    previous_root = config.get_repository_root()

    try:
        paths = config.set_repository_root("   ", persist=False)

        assert config.get_repository_root() == ""
        assert paths == {
            "repositoryRoot": "",
            "rawPath": "",
            "wikiPath": "",
            "knopathPath": "",
            "databasePath": "",
        }
    finally:
        config.set_repository_root(previous_root, persist=False)
