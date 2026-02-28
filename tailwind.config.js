module.exports = {
    darkMode: 'media',
    content: [
        "./pages/**/*.{js,ts,jsx,tsx}",
        "./components/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Lars', 'sans-serif'],
                'nameplate-serif': ['"Playfair Display"', 'Georgia', 'serif'],
                'nameplate-mono': ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
            },
            spacing: {
                '128': '32rem',
            },
            animation: {
                'fade-in': 'fadeIn 0.5s ease-out forwards',
                'reveal': 'reveal 1.1s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: 0 },
                    '100%': { opacity: 1 },
                },
                reveal: {
                    '0%': {
                        opacity: '0',
                        filter: 'blur(12px)',
                        transform: 'translateY(6px)',
                    },
                    '100%': {
                        opacity: '1',
                        filter: 'blur(0px)',
                        transform: 'translateY(0)',
                    },
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
