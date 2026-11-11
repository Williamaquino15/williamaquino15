module.exports = { mkdirSync() {}, existsSync: () => false, readFileSync() { throw new Error('fs indisponível'); } };
