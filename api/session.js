export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ authenticated: false, setupRequired: false });
}
