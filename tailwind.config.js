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
                mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
            // Fantasy app tokens. Values live in styles/fantasy.css as RGB
            // triplets so alpha modifiers (bg-ff-accent/10) work.
            colors: {
                ff: Object.fromEntries(
                    ['bg', 'panel', 'raised', 'sunken', 'line', 'line2', 'text', 'text2', 'muted', 'accent', 'accent2', 'pos', 'neg', 'warn', 's1', 's2', 's3', 's4', 's5'].map(
                        (k) => [k, `rgb(var(--ff-${k}) / <alpha-value>)`],
                    ),
                ),
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
