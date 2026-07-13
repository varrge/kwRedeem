# Full server migration package scope

For full server migration, KaWang will create a sensitive migration package that contains business data and operational configuration, not the project source code. The old server enters a maintenance window before export so the SQLite database and secret-bearing `.env` are captured consistently, while the new server obtains code through the normal deployment path and then imports the package.
