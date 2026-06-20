import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { DialogProvider } from './components/common/DialogProvider';
import { UndoProvider } from './contexts/UndoContext';
import router from './router';

export default function App() {
  return (
    <AuthProvider>
      <DialogProvider>
        <UndoProvider>
          <RouterProvider router={router} />
        </UndoProvider>
      </DialogProvider>
    </AuthProvider>
  );
}
