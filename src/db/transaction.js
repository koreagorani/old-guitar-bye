export function withImmediateTransaction(database, callback) {
  if (database.isTransaction) {
    return callback();
  }

  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}
