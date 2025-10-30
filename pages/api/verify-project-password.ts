import type { NextApiRequest, NextApiResponse } from 'next'

type ResponseData = {
  success: boolean
}

export default function handler(req: NextApiRequest, res: NextApiResponse<ResponseData>) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ success: false })
  }

  const { password } = req.body ?? {}
  const expectedPassword = process.env.PROJECT_PASSWORD

  if (!expectedPassword) {
    console.error('PROJECT_PASSWORD environment variable is not set.')
    return res.status(500).json({ success: false })
  }

  if (typeof password !== 'string') {
    return res.status(400).json({ success: false })
  }

  if (password === expectedPassword) {
    return res.status(200).json({ success: true })
  }

  return res.status(401).json({ success: false })
}
