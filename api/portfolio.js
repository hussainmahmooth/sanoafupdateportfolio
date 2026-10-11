import { promises as fs } from 'node:fs';
import path from 'node:path';

export default async function handler(req, res) {
  try {
    const seedPath = path.join(process.cwd(), 'server', 'seed.json');
    const content = await fs.readFile(seedPath, 'utf8');
    const portfolio = JSON.parse(content);
    const publicData = {
      ...portfolio,
      projects: (portfolio.projects || []).filter(item => item.published),
      thoughts: (portfolio.thoughts || []).filter(item => item.published),
      reviews: (portfolio.reviews || []).filter(item => item.published)
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json(publicData);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load portfolio: ' + error.message });
  }
}
