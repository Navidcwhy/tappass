module.exports = {
  preset: "jest-expo/android",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/__tests__/**/*.test.js"],
};
