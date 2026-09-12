import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const defaultMigrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

export function openDatabase(filename) {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA foreign_keys = ON;");
  return database;
}

export function applyMigrations(
  database,
  migrationsDirectory = defaultMigrationsDirectory,
) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) STRICT;
  `);

  const appliedVersions = new Set(
    database
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map(({ version }) => version),
  );

  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();
  const newlyApplied = [];

  for (const filename of migrationFiles) {
    if (appliedVersions.has(filename)) {
      continue;
    }

    const sql = readFileSync(resolve(migrationsDirectory, filename), "utf8");
    database.exec("BEGIN IMMEDIATE;");
    try {
      database.exec(sql);
      database
        .prepare("INSERT INTO schema_migrations (version) VALUES (?)")
        .run(filename);
      database.exec("COMMIT;");
      newlyApplied.push(filename);
    } catch (error) {
      database.exec("ROLLBACK;");
      throw error;
    }
  }

  return newlyApplied;
}

const isRunDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isRunDirectly) {
  const databasePath = resolve(process.argv[2] ?? "old-guitar-bye.sqlite");
  const database = openDatabase(databasePath);
  try {
    const applied = applyMigrations(database);
    console.log(`Applied ${applied.length} migration(s) to ${databasePath}`);
  } finally {
    database.close();
  }
}
