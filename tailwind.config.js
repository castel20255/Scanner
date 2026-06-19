/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          pink: '#D61A8C',
          orange: '#E67E22',
          purple: '#8E44AD',
        },
      },
      animation: {
        'orb-float': 'orbFloat 4s ease-in-out infinite',
        'halo-pulse': 'haloPulse 2.5s ease-in-out infinite',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        orbFloat: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-10px) scale(1.01)' },
        },
        haloPulse: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.25', filter: 'blur(20px)' },
          '50%': { transform: 'scale(1.4)', opacity: '0.6', filter: 'blur(30px)' },
        },
      },
    },
  },
  plugins: [],
};
