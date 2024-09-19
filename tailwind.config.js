module.exports = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Lars', 'sans-serif'],
            },
            colors: {
                'labels': '#1F1F1F',
                'copy': '#333B40',
            },
            spacing: {
                '128': '32rem',
            },
            animation: {
                'fade-in': 'fadeIn 0.5s ease-out forwards',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: 0 },
                    '100%': { opacity: 1 },
                },
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
        function ({ addUtilities, theme }) {
            const newUtilities = {}
            for (let i = 1; i <= 20; i++) {
                newUtilities[`.animation-delay-${i * 100}`] = {
                    'animation-delay': `${i * 0.1}s`,
                }
            }
            addUtilities(newUtilities)
        },
    ],
}