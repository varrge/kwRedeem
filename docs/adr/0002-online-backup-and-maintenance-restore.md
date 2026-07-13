# Online backup and maintenance restore

KaWang admin will support online migration backup downloads without interrupting user-facing business, but online restore must first put the system into maintenance mode and block writes. Backup packages are sensitive because they include `.env`, while restore is treated as a controlled operational workflow instead of a hot database overwrite.
