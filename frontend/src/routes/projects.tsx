import { Navigate, useNavigate } from 'react-router-dom';
import { Projects } from '../pages/Projects';
import { useAuth } from '../lib/useAuth';

export function ProjectsRoute() {
  const { status } = useAuth();
  const navigate = useNavigate();

  if (status === 'loading') return null;
  if (status === 'anon') return <Navigate to="/start?intent=library&auth=1" replace />;

  return (
    <Projects
      onExit={() => navigate('/')}
      onNew={() => navigate('/start?intent=new')}
      onOpen={(projectId) => navigate(`/editor/${projectId}`)}
    />
  );
}
