import { checkNativeSqlite } from '../src/native-sqlite-check.js';

const result = await checkNativeSqlite();

if (result.ok) {
    console.log('Native SQLite binding check passed.');
} else {
    console.error(result.message);
    process.exitCode = 1;
}
