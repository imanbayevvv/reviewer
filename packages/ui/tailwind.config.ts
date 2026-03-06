import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#f6f6f6',
          card: '#ffffff',
        },
        neutral: {
          50: '#fafafa',
          100: '#f6f6f6',
          200: '#e9e9e9',
          300: '#d8d8d8',
          400: '#b0b0b0',
          500: '#9d9d9d',
          600: '#707070',
          700: '#686868',
          800: '#333333',
          900: '#000000',
        },
      },
      fontFamily: {
        sans: [
          'Google Sans',
          'Inter',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      fontSize: {
        'heading-xl': ['36px', { lineHeight: '44px', fontWeight: '600' }],
        'heading-lg': ['24px', { lineHeight: '32px', fontWeight: '700' }],
        'heading-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '500' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '600' }],
        'body-sm': ['12px', { lineHeight: '16px', fontWeight: '400' }],
        'caption': ['10px', { lineHeight: '14px', fontWeight: '600' }],
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      spacing: {
        '4.5': '18px',
        '13': '52px',
        '15': '60px',
        '18': '72px',
        '20': '80px',
      },
      width: {
        sidebar: '240px',
      },
      borderColor: {
        DEFAULT: 'rgba(0, 0, 0, 0.1)',
      },
    },
  },
  plugins: [],
};

export default config;
