// Database helper
import * as SQLite from 'expo-sqlite';

// `openDatabase` was removed in expo-sqlite v57. The sync opener keeps the same
// module-level handle, so the default export is still a ready-to-use database.
const db = SQLite.openDatabaseSync('breaktheloop.db');
export default db;

