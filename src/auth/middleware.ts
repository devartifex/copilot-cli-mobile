import { Request, Response, NextFunction } from 'express';

export function requireGitHub(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.session?.githubToken) {
    res.status(401).json({ error: 'GitHub authentication required' });
    return;
  }
  next();
}
