import { useNavigate } from 'react-router-dom';
import { Projects } from '../pages/Projects';

export function ProjectsRoute() {
  const navigate = useNavigate();

  return (
    <Projects
      onExit={() => navigate('/')}
      onNew={() => navigate('/editor')}
      onOpen={(projectId) => navigate(`/editor/${projectId}`)}
    />
  );
}
