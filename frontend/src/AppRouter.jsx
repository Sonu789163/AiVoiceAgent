import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import VoiceAgent from './App'; // Your existing App.jsx
import StudentDetails from './components/StudentDetails';
import './AppRouter.css';

function AppRouter() {
    const navigate = useNavigate();
    const location = useLocation();
    const [isAgentRunning, setIsAgentRunning] = useState(false);

    const currentPath = location.pathname;

    const handleNavigation = (path) => {
        if (isAgentRunning) {
            return; // Don't allow navigation when agent is running
        }
        navigate(path);
    };

    return (
        <div className="app-layout">
            {/* Sidebar */}
            <aside className={`sidebar ${isAgentRunning ? 'sidebar-disabled' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">🎓</div>
                </div>

                <nav className="sidebar-nav">
                    <button
                        className={`sidebar-btn ${currentPath === '/' || currentPath === '/agent' ? 'sidebar-btn-active' : ''}`}
                        onClick={() => handleNavigation('/')}
                        disabled={isAgentRunning}
                        title={isAgentRunning ? 'Cannot switch while agent is running' : 'Voice Agent'}
                    >
                        <span className="sidebar-icon">🎙️</span>
                        <span className="sidebar-text">Agent</span>
                    </button>

                    <button
                        className={`sidebar-btn ${currentPath === '/details' ? 'sidebar-btn-active' : ''}`}
                        onClick={() => handleNavigation('/details')}
                        disabled={isAgentRunning}
                        title={isAgentRunning ? 'Cannot switch while agent is running' : 'Student Details'}
                    >
                        <span className="sidebar-icon">📊</span>
                        <span className="sidebar-text">Details</span>
                    </button>
                </nav>

                {isAgentRunning && (
                    <div className="sidebar-status">
                        <div className="status-pulse"></div>
                        <div className="status-label">Active</div>
                    </div>
                )}
            </aside>

            {/* Main Content */}
            <main className="main-area">
                <Routes>
                    <Route
                        path="/"
                        element={<VoiceAgent onCallStatusChange={setIsAgentRunning} />}
                    />
                    <Route
                        path="/agent"
                        element={<VoiceAgent onCallStatusChange={setIsAgentRunning} />}
                    />
                    <Route
                        path="/details"
                        element={<StudentDetails />}
                    />
                </Routes>
            </main>
        </div>
    );
}

export default AppRouter;
