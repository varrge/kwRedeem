# File-backed maintenance mode for restore

Online restore will use a project-local maintenance marker file instead of relying only on database state. Because restore replaces the SQLite database, a database-backed maintenance flag could disappear during the operation and briefly allow user-facing writes, while a file marker survives the database swap and keeps the restore workflow controlled.
