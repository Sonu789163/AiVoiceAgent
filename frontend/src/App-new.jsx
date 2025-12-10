import { useState } from 'react';
import VoiceAgent from './components/VoiceAgent';
import StudentDetails from './components/StudentDetails';
import './AppSidebar.css';

function App() {
    const [activeTab, setActiveTab] = useState('agent'); // 'agent' or 'details'
    const [isAgentRunning, setIsAgentRunning] = useState(false);

    const handleTabChange = (tab) => {
        // Don't allow tab switching when agent is running
        if (isAgentRunning) {
            return;
        }
        setActiveTab(tab);
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
                        className={`sidebar-item ${activeTab === 'agent' ? 'active' : ''} ${isAgentRunning ? 'disabled' : ''}`}
                        onClick={() => handleTabChange('agent')}
                        disabled={isAgentRunning}
                        title={isAgentRunning ? 'Cannot switch while agent is running' : 'Voice Agent'}
                    >
                        <span className="sidebar-icon">🎙️</span>
                        <span className="sidebar-label">Agent</span>
                    </button>

                    <button
                        className={`sidebar-item ${activeTab === 'details' ? 'active' : ''} ${isAgentRunning ? 'disabled' : ''}`}
                        onClick={() => handleTabChange('details')}
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
                {activeTab === 'agent' ? (
                    <VoiceAgent
                        onAgentStatusChange={setIsAgentRunning}
                    />
                ) : (
                    <StudentDetails />
                )}
            </main>
        </div>
    );
}

export default App;
