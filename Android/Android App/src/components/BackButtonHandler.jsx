import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';

const BackButtonHandler = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        let lastBackTime = 0;

        const handleBackButton = async (event) => {
            const path = location.pathname;

            // 0. Main Library (Home) Logic
            if (path === '/') {
                // Check for selection mode (using history state)
                const historyState = window.history.state;
                if (historyState && historyState.selection) {
                    navigate(-1); // Exit selection mode
                    return;
                }
                
                // Check for folder navigation
                if (location.search.includes('folder=')) {
                    navigate(-1); // Back to parent folder or root
                    return;
                }
            }

            // 1. Repository Tab Logic: Check for 'folder' in search params
            if (path === '/library' && location.search.includes('folder=')) {
                navigate(-1); // Back to parent folder or root
                return;
            }

            // 2. Profile Tab Logic: Check for history state 'tab' (sub-pages like Settings)
            if (path === '/me') {
                const historyState = window.history.state;
                // Profile.jsx pushes state: { tab: '...' }
                if (historyState && historyState.tab) {
                    navigate(-1); // Triggers popstate to close tab
                    return;
                }
            }

            // Root paths where back button should exit/minimize
            // (Only if the above specific sub-page checks didn't catch it)
            const rootPaths = ['/', '/login', '/library', '/me'];

            if (rootPaths.includes(path)) {
                // If really on root level of these tabs, exit app
                App.exitApp();
            } else {
                // For any other route (Reader, etc.), go back
                navigate(-1);
            }
        };

        const listener = App.addListener('backButton', handleBackButton);

        return () => {
            listener.then(handler => handler.remove());
        };
    }, [navigate, location]);

    return null;
};

export default BackButtonHandler;
