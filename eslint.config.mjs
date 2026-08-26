import base from '@harrow/config/eslint/base.js';

export default [
  ...base,
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/.turbo/**',
      '**/node_modules/**',
      'analysis/**',
      'firmware/**',
    ],
  },
];
