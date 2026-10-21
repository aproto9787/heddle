// Preload test-only flags before the server module is imported.
// Node's --import works on Windows and POSIX without shell-specific env syntax.
process.env.HEDDLE_SERVER_AUTOSTART = "0";
process.env.HEDDLE_MOCK = "1";
