import { useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import VoiceAgentPage from './pages/VoiceAgentPage';
import StudentDetailsPage from './pages/StudentDetailsPage';
import './Layout.css';

function Layout() {
    const navigate = useNavigate();
    const location = useLocation();
    const [isAgentRunning, setIsAgentRunning] = useState(false);

    const currentPath = location.pathname;

    const handleNavigation = (path) => {
        // Don't allow navigation when agent is running
        if (isAgentRunning) {
            return;
        }
        navigate(path);
    };

    return (
        <div className="app-container">
            {/* Sidebar Navigation */}
            <aside className={`sidebar ${isAgentRunning ? 'disabled' : ''}`}>
                <div className="sidebar-header">
                    <h2 className="sidebar-title">🎓</h2>
                </div>

                <nav className="sidebar-nav">
                    <button
                        className={`sidebar-item ${currentPath === '/' || currentPath === '/agent' ? 'active' : ''} ${isAgentRunning ? 'disabled' : ''}`}
                        onClick={() => handleNavigation('/')}
                        disabled={isAgentRunning}
                        title={isAgentRunning ? 'Cannot switch while agent is running' : 'Voice Agent'}
                    >
                        <span className="sidebar-icon">🎙️</span>
                        <span className="sidebar-label">Agent</span>
                    </button>

                    <button
                        className={`sidebar-item ${currentPath === '/details' ? 'active' : ''} ${isAgentRunning ? 'disabled' : ''}`}
                        onClick={() => handleNavigation('/details')}
                        disabled={isAgentRunning}
                        title={isAgentRunning ? 'Cannot switch while agent is running' : 'Student Details'}
                    >
                        <span className="sidebar-icon">📊</span>
                        <span className="sidebar-label">Details</span>
                    </button>
                </nav>

                {isAgentRunning && (
                    <div className="sidebar-status">
                        <div className="status-indicator">
                            <span className="pulse-dot"></span>
                            <span className="status-text">Agent Active</span>
                        </div>
                    </div>
                )}
            </aside>

            {/* Main Content */}
            <main className="main-content">
                <Routes>
                    <Route
                        path="/"
                        element={<VoiceAgentPage onAgentStatusChange={setIsAgentRunning} />}
                    />
                    <Route
                        path="/agent"
                        element={<VoiceAgentPage onAgentStatusChange={setIsAgentRunning} />}
                    />
                    <Route
                        path="/details"
                        element={<StudentDetailsPage />}
                    />
                </Routes>
            </main>
        </div>
    );
}

export default Layout;
