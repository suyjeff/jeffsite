import nextMDX from '@next/mdx'

const withMDX = nextMDX({
    extension: /\.mdx?$/,
    options: {
        remarkPlugins: [],
        rehypePlugins: [],
    },
})

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
    // ... any other existing configurations
}

export default withMDX(nextConfig)
