import { Request, Response, NextFunction } from 'express';
import { refreshToken } from './azure';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.session?.azureAccount) {
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/login');
    return;
  }

  const result = await refreshToken(req.session.azureAccount.homeAccountId);
  if (result && result.account) {
    req.session.azureAccount = {
      homeAccountId: result.account.homeAccountId,
      username: result.account.username,
      name: result.account.name ?? undefined,
    };
    next();
  } else {
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/login');
  }
}

export function requireGitHubToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.session?.githubToken) {
    req.session.returnTo = req.originalUrl;
    res.redirect('/auth/github');
    return;
  }
  next();
}
