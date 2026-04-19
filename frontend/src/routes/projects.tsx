import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Projects } from '../pages/Projects';
import { useAuth } from '../lib/useAuth';
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
} from '../features/onboarding/storage';
import {
  AuthGateView,
  FirstRunOnboardingView,
} from '../features/onboarding/EntryGate';

export function ProjectsRoute() {
  const { status, user, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [onboardingDone, setOnboardingDone] = useState(() => hasCompletedOnboarding(user?.id));

  useEffect(() => {
    setOnboardingDone(hasCompletedOnboarding(user?.id));
  }, [user?.id]);

  const displayName = useMemo(() => {
    return user?.user_metadata?.full_name
      || user?.user_metadata?.name
      || user?.email?.split('@')[0]
      || 'editor';
  }, [user]);

  if (status === 'loading') return null;
  if (status === 'anon') {
    return (
      <AuthGateView
        scope="library"
        onBack={() => navigate('/')}
        onContinue={() => signInWithGoogle()}
      />
    );
  }

  if (!onboardingDone) {
    return (
      <FirstRunOnboardingView
        displayName={displayName}
        scope="library"
        onEnterStudio={() => {
          markOnboardingComplete(user?.id);
          setOnboardingDone(true);
          navigate('/editor');
        }}
        onOpenLibrary={() => {
          markOnboardingComplete(user?.id);
          setOnboardingDone(true);
        }}
      />
    );
  }

  return (
    <Projects
      onExit={() => navigate('/')}
      onNew={() => navigate('/editor')}
      onOpen={(projectId) => navigate(`/editor/${projectId}`)}
    />
  );
}
