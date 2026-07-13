import { createContext, useContext } from 'react';

export const UndoContext = createContext(null);

export const useUndo = () => useContext(UndoContext);
