import nextMDX from '@next/mdx'

const withMDX = nextMDX({
    extension: /\.mdx?$/,
    options: {
        remarkPlugins: [],
        rehypePlugins: [],
    },
})

export default withMDX({
    pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'export',
    // ... any other existing configurations
}

module.exports = nextConfig
