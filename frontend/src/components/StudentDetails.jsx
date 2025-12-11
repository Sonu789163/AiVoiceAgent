import { useState, useEffect } from 'react';
import '../StudentDetails.css';

const API_URL = import.meta.env.VITE_API_URL;

export default function StudentDetails() {
    const [students, setStudents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        fetchStudentData();
        // Refresh every 10 seconds
        const interval = setInterval(() => {
            fetchStudentData();
        }, 10000);
        return () => clearInterval(interval);
    }, []);

    const fetchStudentData = async () => {
        try {
            setError(null);
            setIsRefreshing(true);
            const response = await fetch(`${API_URL}/api/students`);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            setStudents(data);
            setLoading(false);
            setLastUpdated(new Date());
        } catch (err) {
            console.error('Error fetching student data:', err);
            setError(err.message);
            setLoading(false);
        } finally {
            setIsRefreshing(false);
        }
    };

    const filteredStudents = students.filter(student =>
        Object.values(student).some(value =>
            String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
    );

    if (loading) {
        return (
            <div className="student-details">
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading student data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="student-details">
            <div className="details-header">
                <h2>📊 Student Details</h2>
                <div className="details-actions">
                    <input
                        type="text"
                        placeholder="🔍 Search students..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                    <button
                        onClick={fetchStudentData}
                        className={`refresh-btn ${isRefreshing ? 'refreshing' : ''}`}
                        disabled={isRefreshing}
                    >
                        <span className={isRefreshing ? 'spin' : ''}>🔄</span>
                        {isRefreshing ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-banner">
                    ⚠️ Error loading data: {error}
                    <button onClick={fetchStudentData} className="retry-btn">Try Again</button>
                </div>
            )}

            <div className="table-container">
                <table className="students-table">
                    <thead>
                        <tr>
                            <th>Session ID</th>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Course Interest</th>
                            <th>City</th>
                            <th>Education</th>
                            <th>Intake Year</th>
                            <th>Budget</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody className="table-body">
                        {filteredStudents.length === 0 ? (
                            <tr>
                                <td colSpan="9" className="no-data">
                                    {searchTerm ? 'No students found matching your search' : 'No student data available yet'}
                                </td>
                            </tr>
                        ) : (
                            filteredStudents.map((student, index) => (
                                <tr key={student.sessionId || index} className={student.status === 'Confirmed' ? 'row-confirmed' : ''}>
                                    <td className="session-id">{student.sessionId || '-'}</td>
                                    <td className="student-name">{student.name || '-'}</td>
                                    <td>{student.phoneNumber || '-'}</td>
                                    <td>{student.programInterest || '-'}</td>
                                    <td>{student.city || '-'}</td>
                                    <td>{student.priorEducation || '-'}</td>
                                    <td>{student.intakeYear || '-'}</td>
                                    <td>{student.budget || '-'}</td>
                                    <td>
                                        <span className={`status-badge ${student.status === 'Confirmed' ? 'status-confirmed' : 'status-partial'}`}>
                                            {student.status || 'Partial'}
                                        </span>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <div className="table-footer">
                <p style={{ color: "white" }}>
                    <strong>Total Students:</strong> {filteredStudents.length}
                    {searchTerm && students.length !== filteredStudents.length &&
                        ` (filtered from ${students.length})`
                    }
                </p>
                <p style={{ color: "white" }}>
                    <strong>Last Updated:</strong> {lastUpdated.toLocaleTimeString()}
                </p>
            </div>
        </div>
    );
}
