// ESM, because package.json declares "type": "module". The Next app used
// CommonJS here; that syntax is a hard error under this package type.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
