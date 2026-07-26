import { RouterProvider } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { DialogProvider } from './components/common/DialogProvider';
import { UndoProvider } from './contexts/UndoContext';
import { UploadProvider } from './contexts/UploadContext';
import UploadDock from './components/common/UploadDock';
import router from './router';

export default function App() {
  return (
    <AuthProvider>
      <DialogProvider>
        <UndoProvider>
          <UploadProvider>
            <RouterProvider router={router} />
            <UploadDock />
          </UploadProvider>
        </UndoProvider>
      </DialogProvider>
    </AuthProvider>
  );
}
