import { authCopy } from '@/copy/auth';
import { getCurrentMember } from '@/server/auth';

/** Sign-in link for visitors; identity and sign-out for members. */
export async function AuthStatus() {
  const member = await getCurrentMember();

  if (!member) {
    return (
      <a className="underline underline-offset-4" href="/auth/sign-in">
        {authCopy.signIn}
      </a>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="auth-status">
      <span>{member.login ? authCopy.signedInAs(member.login) : authCopy.signedIn}</span>
      <form action="/auth/sign-out" method="post">
        <button className="underline underline-offset-4" type="submit">
          {authCopy.signOut}
        </button>
      </form>
    </div>
  );
}
