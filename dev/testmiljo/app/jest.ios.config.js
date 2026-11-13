module.exports = {
  preset: "jest-expo/ios",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/__tests__/**/*.test.js"],
};
