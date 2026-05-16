import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { DialogProvider } from './components/common/DialogProvider';
import router from './router';

export default function App() {
  return (
    <AuthProvider>
      <DialogProvider>
        <RouterProvider router={router} />
      </DialogProvider>
    </AuthProvider>
  );
}
