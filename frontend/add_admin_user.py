"""Retired legacy administrator bootstrap. No database changes are performed."""

if __name__ == "__main__":
    raise SystemExit(
        "Automatic administrator provisioning is disabled. Use npm run setup:user "
        "from frontend to create a regular user, then manage roles directly in the database."
    )
