import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getOAuthRedirect, supabase } from "./supabase";

// ── auth state ────────────────────────────────────────────────────
// thin react context over the supabase session. one source of truth:
// whenever supabase fires onAuthStateChange, we re-render.

type AuthState = {
  session: Session | null;
  user: User | null;
  status: "loading" | "authed" | "anon";
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus(data.session ? "authed" : "anon");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setStatus(s ? "authed" : "anon");
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getOAuthRedirect(),
        // ask for the basics. add "profile email" explicitly in case the
        // supabase dashboard default scope is narrower.
        scopes: "openid email profile",
      },
    });
    if (error) {
      // eslint-disable-next-line no-alert
      alert(`google sign-in failed: ${error.message}`);
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      status,
      signInWithGoogle,
      signOut,
    }),
    [session, status, signInWithGoogle, signOut],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
