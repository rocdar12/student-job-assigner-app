import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
    getAuth, 
    signInAnonymously, 
    signInWithCustomToken, 
    onAuthStateChanged
} from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';

// Global variables provided by the Canvas environment
// These are placeholders for the actual values that will be injected by the environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase outside the component to avoid re-initialization on re-renders
let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
} catch (error) {
    console.error("Failed to initialize Firebase:", error);
    // Optionally, set a state to show an error message in the UI if Firebase init fails
}

// Default values for students and jobs (hardcoded fallback if Firestore data is empty)
const DEFAULT_STUDENTS = Array.from({ length: 23 }, (_, i) => i + 1);
const DEFAULT_JOB_TITLES = [
    'Line Leader', 'Door Holder', 'Caboose', 'Calendar Helper', 'Weather Reporter',
    'Pencil Monitor', 'Snack Helper', 'Table Washer', 'Librarian', 'Supply Manager',
    'Chair Stacker', 'Plant Waterer', 'Pet Helper', 'Board Eraser', 'Technology Helper',
    'Recycling Monitor', 'Paper Passer', 'Greeter', 'Messenger', 'Quiet Captain',
    'Time Keeper', 'Flag Holder', 'Classroom Helper'
];

// Helper function to shuffle an array (Fisher-Yates shuffle algorithm)
const shuffleArray = (array) => {
    let currentIndex = array.length, randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex !== 0) {
        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
};

const App = () => {
    // State to hold the current user's unique ID for Firestore operations
    const [userId, setUserId] = useState(null); 
    // State to manage the loading status of the application
    const [loading, setLoading] = useState(true);
    // Main application state, holding all data related to students, jobs, and assignments
    const [appState, setAppState] = useState({
        students: DEFAULT_STUDENTS,
        jobTitles: DEFAULT_JOB_TITLES,
        currentAssignments: {}, // Current week's student-to-job assignments
        remainingStudentsInCycle: [], // Students yet to be assigned in the current cycle
        studentJobHistory: {}, // History of jobs assigned to each student
        lastAssignmentDate: null, // Timestamp of the last job assignment
        userDefaultStudents: [], // User-defined default student list
        userDefaultJobTitles: [], // User-defined default job title list
    });
    // State for displaying messages to the user
    const [message, setMessage] = useState('');
    // States to control the visibility of confirmation modals
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showResetHistoryConfirm, setShowResetHistoryConfirm] = useState(false);
    // States to control the visibility of management modals
    const [showJobTitlesModal, setShowJobTitlesModal] = useState(false);
    const [newJobTitle, setNewJobTitle] = useState(''); // Input for adding new job titles
    const [showStudentsModal, setShowStudentsModal] = useState(false);
    const [newStudentNumber, setNewStudentNumber] = useState(''); // Input for adding new student numbers

    // Refs for drag and drop functionality (to store indices of dragged/hovered items)
    const dragItem = useRef(null);
    const dragOverItem = useRef(null);
    // State to hold assignments for display, allowing reordering via drag-and-drop
    const [displayAssignments, setDisplayAssignments] = useState([]);

    // Effect to update displayAssignments whenever currentAssignments in appState changes
    useEffect(() => {
        const assignmentsArray = Object.entries(appState.currentAssignments)
            .map(([studentNum, jobTitle]) => ({ studentNum: parseInt(studentNum), jobTitle }))
            .sort((a, b) => a.studentNum - b.studentNum); // Sort by student number for consistent display
        setDisplayAssignments(assignmentsArray);
    }, [appState.currentAssignments]);

    // Effect for Firebase Authentication (Anonymous or Custom Token)
    useEffect(() => {
        // Check if Firebase instances are available
        if (!auth || !db) {
            setMessage("Firebase not initialized. Please check your console for errors.");
            setLoading(false); // Stop loading if Firebase isn't ready
            return;
        }

        // Listener for authentication state changes
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (user) {
                // If a user is already authenticated (e.g., from a previous session or custom token)
                setUserId(user.uid);
            } else {
                // If no user is authenticated, attempt to sign in
                try {
                    // Try to sign in with a custom token if provided (e.g., by the Canvas environment)
                    if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                    } else {
                        // Otherwise, sign in anonymously
                        await signInAnonymously(auth);
                    }
                    // Set userId from the authenticated user, or generate a random one as fallback
                    setUserId(auth.currentUser?.uid || crypto.randomUUID()); 
                } catch (error) {
                    console.error("Firebase authentication failed:", error);
                    setMessage("Failed to authenticate. Please try again.");
                }
            }
            // Once authentication state is determined (user or anonymous), stop loading
            setLoading(false);
        });

        // Cleanup function for the auth state listener
        return () => unsubscribeAuth();
    }, [auth, db, initialAuthToken]); // Dependencies for this effect

    // Effect for loading application data from Firestore (dependent on userId)
    useEffect(() => {
        // Only proceed if userId and db are available
        if (!userId || !db) {
            return;
        }

        let stateLoaded = false;
        let defaultsLoaded = false;

        // Helper function to check if both state and defaults are loaded
        const checkLoadingComplete = () => {
            if (stateLoaded && defaultsLoaded) {
                // This function is primarily for internal tracking within this effect.
                // The main app loading state is controlled by the auth effect.
            }
        };

        // Document references for the main app state and user-defined defaults
        const stateDocRef = doc(db, `artifacts/${appId}/users/${userId}/job_assigner`, 'state');
        const defaultsDocRef = doc(db, `artifacts/${appId}/users/${userId}/job_assigner`, 'defaults');

        // Subscribe to real-time updates for the main app state document
        const unsubscribeState = onSnapshot(stateDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                // Update appState with fetched data, using defaults if fields are missing
                setAppState(prevState => ({
                    ...prevState,
                    ...data,
                    students: data.students || DEFAULT_STUDENTS,
                    jobTitles: data.jobTitles || DEFAULT_JOB_TITLES,
                    remainingStudentsInCycle: data.remainingStudentsInCycle || [],
                    currentAssignments: data.currentAssignments || {},
                    studentJobHistory: data.studentJobHistory || {},
                }));
                setMessage('State loaded successfully!');
            } else {
                // If state document doesn't exist, initialize it with default values
                // Prioritize user-defined defaults if they exist, otherwise use hardcoded defaults
                const initialStudents = appState.userDefaultStudents.length > 0 ? appState.userDefaultStudents : DEFAULT_STUDENTS;
                const initialJobs = appState.userDefaultJobTitles.length > 0 ? appState.userDefaultJobTitles : DEFAULT_JOB_TITLES;
                
                setDoc(stateDocRef, {
                    students: initialStudents,
                    jobTitles: initialJobs,
                    currentAssignments: {},
                    remainingStudentsInCycle: shuffleArray([...initialStudents]),
                    studentJobHistory: {},
                    lastAssignmentDate: null,
                })
                    .then(() => setMessage('Initialized default state.'))
                    .catch(error => console.error("Error setting initial state document:", error));
            }
            stateLoaded = true;
            checkLoadingComplete();
        }, (error) => {
            console.error("Error listening to state document:", error);
            setMessage("Error loading state. Please check console.");
            stateLoaded = true;
            checkLoadingComplete();
        });

        // Subscribe to real-time updates for the user defaults document
        const unsubscribeDefaults = onSnapshot(defaultsDocRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                // Update appState with user-defined default students and job titles
                setAppState(prevState => ({
                    ...prevState,
                    userDefaultStudents: data.students || [],
                    userDefaultJobTitles: data.jobTitles || [],
                }));
            } else {
                // If defaults document doesn't exist, create it with empty arrays
                setDoc(defaultsDocRef, { students: [], jobTitles: [] })
                    .catch(error => console.error("Error setting initial defaults document:", error));
            }
            defaultsLoaded = true;
            checkLoadingComplete();
        }, (error) => {
            console.error("Error listening to defaults document:", error);
            defaultsLoaded = true;
            checkLoadingComplete();
        });

        // Cleanup function for Firestore listeners
        return () => {
            unsubscribeState();
            unsubscribeDefaults();
        };
    }, [userId, db, appState.userDefaultStudents, appState.userDefaultJobTitles]); // Dependencies for this effect

    // Function to save the current app state to Firestore
    const saveState = useCallback(async (newState) => {
        // Ensure userId and db are available before attempting to save
        if (!userId || !db) {
            setMessage("Cannot save: User not authenticated or Firestore not ready.");
            return;
        }
        const docRef = doc(db, `artifacts/${appId}/users/${userId}/job_assigner`, 'state');
        try {
            await setDoc(docRef, newState); // Use setDoc to overwrite or create the document
            setAppState(newState); // Update local state after successful save
            setMessage('State saved successfully!');
        } catch (error) {
            console.error("Error saving state:", error);
            setMessage("Error saving state. Please try again.");
        }
    }, [userId, db]); // Dependencies for this memoized function

    // Function to save user-defined default students or job titles to Firestore
    const saveDefaults = useCallback(async (type) => {
        // Ensure userId and db are available before attempting to save defaults
        if (!userId || !db) {
            setMessage("Cannot save defaults: User not authenticated or Firestore not ready.");
            return;
        }
        const defaultsDocRef = doc(db, `artifacts/${appId}/users/${userId}/job_assigner`, 'defaults');
        try {
            if (type === 'students') {
                // Update only the 'students' field in the defaults document
                await updateDoc(defaultsDocRef, { students: appState.students });
                setMessage('Current students saved as new defaults!');
            } else if (type === 'jobs') {
                // Update only the 'jobTitles' field in the defaults document
                await updateDoc(defaultsDocRef, { jobTitles: appState.jobTitles });
                setMessage('Current job titles saved as new defaults!');
            }
            // Update local state to reflect the new user defaults
            setAppState(prevState => ({
                ...prevState,
                userDefaultStudents: type === 'students' ? prevState.students : prevState.userDefaultStudents,
                userDefaultJobTitles: type === 'jobs' ? prevState.jobTitles : prevState.userDefaultJobTitles,
            }));
        } catch (error) {
            console.error("Error saving defaults:", error);
            setMessage("Error saving defaults. Please try again.");
        }
    }, [userId, db, appState.students, appState.jobTitles]); // Dependencies for this memoized function

    // Function to generate new weekly assignments
    const generateWeeklyAssignments = useCallback(() => {
        setMessage(''); // Clear previous messages

        let { students, jobTitles, studentJobHistory } = appState;

        // Basic validation
        if (students.length === 0 || jobTitles.length === 0) {
            setMessage("Please add students and job titles before assigning jobs.");
            return;
        }

        if (students.length < jobTitles.length) {
            setMessage("Warning: More job titles than students. Some jobs may not be assigned.");
        }

        let newCurrentAssignments = {};
        let newStudentJobHistory = { ...studentJobHistory };
        let newRemainingStudentsInCycle = [...appState.remainingStudentsInCycle];

        // If no students are left in the current cycle, start a new one
        if (newRemainingStudentsInCycle.length === 0) {
            newRemainingStudentsInCycle = shuffleArray([...students]);
            setMessage("Starting a new cycle: All students are now available for assignment.");
        }

        // Create a shuffled list of available students for this week
        let availableStudentsForThisWeek = shuffleArray([...students]);
        let studentsAssignedThisWeek = new Set(); // Track students already assigned this week

        const shuffledJobTitles = shuffleArray([...jobTitles]); // Shuffle job titles for fairness

        shuffledJobTitles.forEach(job => {
            let assignedStudent = null;
            let bestStudentCandidate = null;
            let bestStudentCandidateHistory = [];

            // Filter students who haven't been assigned a job yet this week
            const eligibleStudentsForJob = availableStudentsForThisWeek.filter(
                studentNum => !studentsAssignedThisWeek.has(studentNum)
            );

            if (eligibleStudentsForJob.length === 0) {
                setMessage(prev => prev + (prev ? " " : "") + "Not enough unique students to assign all jobs this week. Some jobs were skipped.");
                return; // Skip this job if no eligible students
            }

            // Try to find a student who hasn't had this job recently (last 2 assignments)
            for (const studentNum of eligibleStudentsForJob) {
                const history = newStudentJobHistory[studentNum] || [];
                const recentHistoryJobs = history.slice(-2); // Get last 2 jobs

                if (!recentHistoryJobs.includes(job)) {
                    bestStudentCandidate = studentNum;
                    bestStudentCandidateHistory = history;
                    break; // Found a good candidate, break loop
                }
            }

            // If no student found who hasn't had it recently, try finding one who hasn't had it at all
            if (bestStudentCandidate === null) {
                for (const studentNum of eligibleStudentsForJob) {
                    const history = newStudentJobHistory[studentNum] || [];
                    if (!history.includes(job)) {
                        bestStudentCandidate = studentNum;
                        bestStudentCandidateHistory = history;
                        setMessage(prev => prev + (prev ? " " : "") + `Warning: Student ${studentNum} was assigned job "${job}" even though it's in their recent history, as no better option was available.`);
                        break;
                    }
                }
            }

            // If still no ideal candidate, just pick the first eligible student (they've had it before)
            if (bestStudentCandidate === null && eligibleStudentsForJob.length > 0) {
                bestStudentCandidate = eligibleStudentsForJob[0];
                bestStudentCandidateHistory = newStudentJobHistory[bestStudentCandidate] || [];
                setMessage(prev => prev + (prev ? " " : "") + `Warning: Student ${bestStudentCandidate} was assigned job "${job}" even though they've had it before, as all eligible students have had this job.`);
            }

            assignedStudent = bestStudentCandidate;

            // If a student was assigned, update assignments and history
            if (assignedStudent !== null) {
                newCurrentAssignments[assignedStudent] = job;
                studentsAssignedThisWeek.add(assignedStudent); // Mark student as assigned for this week

                // Add the new job to the student's history
                newStudentJobHistory[assignedStudent] = [...(bestStudentCandidateHistory || []), job];

                // Remove the assigned student from the remaining students in the cycle
                const indexInCycle = newRemainingStudentsInCycle.indexOf(assignedStudent);
                if (indexInCycle > -1) {
                    newRemainingStudentsInCycle.splice(indexInCycle, 1);
                }
            }
        });

        // Add a message if a new cycle is completed
        if (newRemainingStudentsInCycle.length === 0 && students.length > 0) {
            setMessage(prev => prev + (prev ? " " : "") + "All students have received a job in this cycle. Next assignment will start a new cycle.");
        }

        // Save the updated state to Firestore
        saveState({
            ...appState,
            currentAssignments: newCurrentAssignments,
            remainingStudentsInCycle: newRemainingStudentsInCycle,
            studentJobHistory: newStudentJobHistory,
            lastAssignmentDate: new Date().toISOString(), // Record assignment date
        });

    }, [appState, saveState]); // Dependencies for this memoized function

    // Function to reset all assignment history (current assignments, remaining cycle, and job history)
    const resetAssignmentHistory = useCallback(() => {
        const studentsToUse = appState.students; // Use current students list
        const newState = {
            ...appState,
            currentAssignments: {}, // Clear current assignments
            remainingStudentsInCycle: shuffleArray([...studentsToUse]), // Reset and shuffle remaining students
            studentJobHistory: {}, // Clear all job history
            lastAssignmentDate: null, // Clear last assignment date
        };
        saveState(newState); // Save the reset state
        setMessage("Student assignment history has been reset.");
        setShowResetHistoryConfirm(false); // Close confirmation modal
    }, [saveState, appState]); // Dependencies for this memoized function

    // Function to reset ALL app data to default (or user-defined defaults)
    const resetAll = useCallback(() => {
        // Determine which student and job lists to use for reset
        const studentsToUse = appState.userDefaultStudents.length > 0 ? appState.userDefaultStudents : DEFAULT_STUDENTS;
        const jobsToUse = appState.userDefaultJobTitles.length > 0 ? appState.userDefaultJobTitles : DEFAULT_JOB_TITLES;

        const newState = {
            students: studentsToUse,
            jobTitles: jobsToUse,
            currentAssignments: {},
            remainingStudentsInCycle: shuffleArray([...studentsToUse]),
            studentJobHistory: {},
            lastAssignmentDate: null,
            userDefaultStudents: appState.userDefaultStudents, // Keep user defaults
            userDefaultJobTitles: appState.userDefaultJobTitles, // Keep user defaults
        };
        saveState(newState); // Save the completely reset state
        setMessage("All data has been reset to defaults (user-defined or original).");
        setShowResetConfirm(false); // Close confirmation modal
    }, [saveState, appState.userDefaultStudents, appState.userDefaultJobTitles, appState]); // Dependencies for this memoized function

    // Function to clear only the current week's assignments
    const clearCurrentAssignments = useCallback(() => {
        saveState({
            ...appState,
            currentAssignments: {}, // Clear only current assignments
            lastAssignmentDate: null, // Clear last assignment date
        });
        setMessage("Current week's assignments cleared.");
    }, [appState, saveState]); // Dependencies for this memoized function

    // Function to add a new job title
    const addJobTitle = () => {
        if (newJobTitle.trim() && !appState.jobTitles.includes(newJobTitle.trim())) {
            const updatedJobTitles = [...appState.jobTitles, newJobTitle.trim()];
            saveState({ ...appState, jobTitles: updatedJobTitles }); // Save updated list
            setNewJobTitle(''); // Clear input field
        } else if (appState.jobTitles.includes(newJobTitle.trim())) {
            setMessage("Job title already exists.");
        }
    };

    // Function to remove a job title
    const removeJobTitle = (jobToRemove) => {
        const updatedJobTitles = appState.jobTitles.filter(job => job !== jobToRemove);
        saveState({ ...appState, jobTitles: updatedJobTitles }); // Save updated list
    };

    // Function to add a new student number
    const addStudent = () => {
        const num = parseInt(newStudentNumber.trim(), 10); // Parse input as integer
        if (!isNaN(num) && num > 0 && !appState.students.includes(num)) {
            const updatedStudents = [...appState.students, num].sort((a, b) => a - b); // Add and sort
            saveState({ ...appState, students: updatedStudents }); // Save updated list
            setNewStudentNumber(''); // Clear input field
        } else if (appState.students.includes(num)) {
            setMessage("Student number already exists.");
        } else {
            setMessage("Invalid student number. Must be a positive integer.");
        }
    };

    // Function to remove a student
    const removeStudent = (studentToRemove) => {
        const updatedStudents = appState.students.filter(s => s !== studentToRemove);
        // Also remove from remaining cycle, current assignments, and history
        const updatedRemainingStudents = appState.remainingStudentsInCycle.filter(s => s !== studentToRemove);
        const updatedAssignments = { ...appState.currentAssignments };
        delete updatedAssignments[studentToRemove];
        const updatedHistory = { ...appState.studentJobHistory };
        delete updatedHistory[studentToRemove];

        saveState({
            ...appState,
            students: updatedStudents,
            remainingStudentsInCycle: updatedRemainingStudents,
            currentAssignments: updatedAssignments,
            studentJobHistory: updatedHistory,
        });
    };

    // Drag and Drop Handlers for reordering current assignments display
    const handleDragStart = (e, index) => {
        dragItem.current = index; // Store the index of the dragged item
    };

    const handleDragEnter = (e, index) => {
        dragOverItem.current = index; // Store the index of the item being dragged over
    };

    const handleDragEnd = () => {
        if (dragItem.current === null || dragOverItem.current === null) return;

        const copiedListItems = [...displayAssignments];
        const draggedItemContent = copiedListItems[dragItem.current];
        copiedListItems.splice(dragItem.current, 1); // Remove dragged item from its original position
        copiedListItems.splice(dragOverItem.current, 0, draggedItemContent); // Insert it at the new position

        dragItem.current = null; // Reset refs
        dragOverItem.current = null;
        setDisplayAssignments(copiedListItems); // Update display order
    };

    const handleDragOver = (e) => {
        e.preventDefault(); // Prevent default to allow dropping
    };

    // Display a loading message while the app is initializing
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <p className="text-lg font-semibold text-gray-700">Loading application...</p>
            </div>
        );
    }

    // Main application UI
    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 font-inter text-gray-800">
            {/* Tailwind CSS and Inter font loading */}
            <script src="https://cdn.tailwindcss.com"></script>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />

            {/* Custom CSS for modals and draggable items */}
            <style>
                {`
                body { font-family: 'Inter', sans-serif; }
                .modal-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: white;
                    padding: 2rem;
                    border-radius: 1rem;
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
                    max-width: 90%;
                    max-height: 90%;
                    overflow-y: auto;
                }
                .draggable-item:hover {
                    cursor: grab;
                    background-color: #f0f4f8; /* Light blue-gray on hover */
                }
                .draggable-item:active {
                    cursor: grabbing;
                }
                `}
            </style>

            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-6 md:p-8">
                <h1 className="text-3xl md:text-4xl font-bold text-center text-indigo-700 mb-6">
                    Student Job Assigner
                </h1>

                {/* Display User ID (for anonymous persistence) */}
                {userId && (
                    <p className="text-sm text-center text-gray-500 mb-4">
                        Your User ID: <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">{userId}</span>
                    </p>
                )}

                {/* Display general messages */}
                {message && (
                    <div className="bg-blue-100 border border-blue-400 text-blue-700 px-4 py-3 rounded-lg mb-6 text-center" role="alert">
                        {message}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    {/* Current Assignments Section */}
                    <div className="bg-purple-50 p-6 rounded-lg shadow-md">
                        <h2 className="text-2xl font-semibold text-purple-700 mb-4">Current Week's Assignments</h2>
                        {displayAssignments.length > 0 ? (
                            <ul className="space-y-2">
                                {displayAssignments.map((assignment, index) => (
                                    <li
                                        key={assignment.studentNum}
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                        onDragEnter={(e) => handleDragEnter(e, index)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={handleDragOver}
                                        className="draggable-item flex items-center justify-between bg-white p-3 rounded-md shadow-sm border border-gray-200"
                                    >
                                        <span className="font-medium text-lg text-gray-700">Student {assignment.studentNum}</span>
                                        <span className="text-purple-600 font-semibold">{assignment.jobTitle}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-gray-500 italic">No assignments yet for this week.</p>
                        )}
                        {appState.lastAssignmentDate && (
                            <p className="text-sm text-gray-500 mt-4">
                                Last assigned: {new Date(appState.lastAssignmentDate).toLocaleString()}
                            </p>
                        )}
                    </div>

                    {/* Controls Section */}
                    <div className="bg-green-50 p-6 rounded-lg shadow-md flex flex-col justify-between">
                        <div>
                            <h2 className="text-2xl font-semibold text-green-700 mb-4">Actions</h2>
                            <button
                                onClick={generateWeeklyAssignments}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 mb-4"
                            >
                                Assign All Jobs for the Week
                            </button>
                            <button
                                onClick={clearCurrentAssignments}
                                className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-opacity-75 mb-4"
                            >
                                Clear Current Week's Assignments
                            </button>
                            <button
                                onClick={() => setShowJobTitlesModal(true)}
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 mb-4"
                            >
                                Manage Job Titles ({appState.jobTitles.length})
                            </button>
                            <button
                                onClick={() => setShowStudentsModal(true)}
                                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 mb-4"
                            >
                                Manage Students ({appState.students.length})
                            </button>
                            <button
                                onClick={() => setShowResetHistoryConfirm(true)}
                                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-opacity-75 mb-4"
                            >
                                Reset Assignment History
                            </button>
                        </div>
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transform transition duration-300 ease-in-out hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75 mt-auto"
                        >
                            Reset All Data
                        </button>
                    </div>
                </div>

                {/* Debug/Info Section (Shows remaining students in cycle and job history) */}
                <div className="bg-gray-50 p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-semibold text-gray-700 mb-4">App Status</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <h3 className="text-lg font-medium text-gray-600 mb-2">Remaining Students in Cycle:</h3>
                            <p className="text-gray-800">
                                {appState.remainingStudentsInCycle.length > 0
                                    ? appState.remainingStudentsInCycle.join(', ')
                                    : 'All students have been assigned in this cycle. Next assignment will start a new cycle.'}
                            </p>
                        </div>
                        <div>
                            <h3 className="text-lg font-medium text-gray-600 mb-2">Student Job History:</h3>
                            <div className="max-h-48 overflow-y-auto bg-white p-3 rounded-md border border-gray-200">
                                {Object.keys(appState.studentJobHistory).length > 0 ? (
                                    Object.entries(appState.studentJobHistory)
                                        .sort(([s1], [s2]) => parseInt(s1) - parseInt(s2)) // Sort history by student number
                                        .map(([studentNum, history]) => (
                                            <p key={`history-${studentNum}`} className="text-sm text-gray-700">
                                                <span className="font-semibold">Student {studentNum}:</span> {history.join(', ')}
                                            </p>
                                        ))
                                ) : (
                                    <p className="text-gray-500 italic">No job history yet.</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reset All Data Confirmation Modal */}
            {showResetConfirm && (
                <div className="modal-overlay">
                    <div className="modal-content text-center">
                        <h3 className="text-xl font-bold mb-4">Confirm Reset All Data</h3>
                        <p className="mb-6">Are you sure you want to reset ALL application data (students, jobs, and history)? This action cannot be undone. This will reset to your saved defaults, or original defaults if none are saved.</p>
                        <div className="flex justify-center space-x-4">
                            <button
                                onClick={resetAll}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Yes, Reset All
                            </button>
                            <button
                                onClick={() => setShowResetConfirm(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Reset Assignment History Confirmation Modal */}
            {showResetHistoryConfirm && (
                <div className="modal-overlay">
                    <div className="modal-content text-center">
                        <h3 className="text-xl font-bold mb-4">Confirm Reset Assignment History</h3>
                        <p className="mb-6">Are you sure you want to clear only the current assignments and all student job history? Your student list and job titles will remain unchanged.</p>
                        <div className="flex justify-center space-x-4">
                            <button
                                onClick={resetAssignmentHistory}
                                className="bg-orange-600 hover:bg-orange-700 text-white font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Yes, Reset History
                            </button>
                            <button
                                onClick={() => setShowResetHistoryConfirm(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Job Titles Modal */}
            {showJobTitlesModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3 className="text-xl font-bold mb-4">Manage Job Titles</h3>
                        <div className="mb-4 flex">
                            <input
                                type="text"
                                value={newJobTitle}
                                onChange={(e) => setNewJobTitle(e.target.value)}
                                placeholder="Add new job title"
                                className="flex-grow border border-gray-300 rounded-l-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <button
                                onClick={addJobTitle}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r-lg"
                            >
                                Add
                            </button>
                        </div>
                        <ul className="space-y-2 max-h-60 overflow-y-auto mb-4 border border-gray-200 p-2 rounded-md">
                            {appState.jobTitles.length > 0 ? (
                                appState.jobTitles.map((job, index) => (
                                    <li key={index} className="flex justify-between items-center bg-gray-50 p-2 rounded-md">
                                        <span>{job}</span>
                                        <button
                                            onClick={() => removeJobTitle(job)}
                                            className="text-red-500 hover:text-red-700 font-bold ml-4"
                                        >
                                            &times;
                                        </button>
                                    </li>
                                ))
                            ) : (
                                <p className="text-gray-500 italic">No job titles defined.</p>
                            )}
                        </ul>
                        <div className="flex justify-end space-x-2 mt-4">
                            <button
                                onClick={() => saveDefaults('jobs')}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Save Current as Default
                            </button>
                            <button
                                onClick={() => setShowJobTitlesModal(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Students Modal */}
            {showStudentsModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3 className="text-xl font-bold mb-4">Manage Students</h3>
                        <div className="mb-4 flex">
                            <input
                                type="number"
                                value={newStudentNumber}
                                onChange={(e) => setNewStudentNumber(e.target.value)}
                                placeholder="Add new student number"
                                className="flex-grow border border-gray-300 rounded-l-lg p-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            />
                            <button
                                onClick={addStudent}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r-lg"
                            >
                                Add
                            </button>
                        </div>
                        <ul className="space-y-2 max-h-60 overflow-y-auto mb-4 border border-gray-200 p-2 rounded-md">
                            {appState.students.length > 0 ? (
                                appState.students.map((student, index) => (
                                    <li key={index} className="flex justify-between items-center bg-gray-50 p-2 rounded-md">
                                        <span>Student {student}</span>
                                        <button
                                            onClick={() => removeStudent(student)}
                                            className="text-red-500 hover:text-red-700 font-bold ml-4"
                                        >
                                            &times;
                                        </button>
                                    </li>
                                ))
                            ) : (
                                <p className="text-gray-500 italic">No students defined.</p>
                            )}
                        </ul>
                        <div className="flex justify-end space-x-2 mt-4">
                            <button
                                onClick={() => saveDefaults('students')}
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Save Current as Default
                            </button>
                            <button
                                onClick={() => setShowStudentsModal(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-5 rounded-lg shadow-md"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
