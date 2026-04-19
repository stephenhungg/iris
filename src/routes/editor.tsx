import { useParams, useNavigate } from 'react-router-dom';
import { Studio } from '../pages/Studio';

export function EditorRoute() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  return (
    <Studio
      onExit={() => navigate('/')}
      onLibrary={() => navigate('/projects')}
      initialProject={
        projectId
          ? { projectId, videoUrl: '', duration: 0, fps: 24 }
          : undefined
      }
    />
  );
}
