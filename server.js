const express = require('express');
const mysql = require('mysql');
const session = require('express-session');
const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(express.urlencoded({ extended: true })); // To handle form data

// Session configuration (ensure you have installed the express-session package)

app.use(session({
    secret: 'secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: !true }
}));

// MySQL connection configuration
const db = mysql.createConnection({
    host: 'localhost',
    user: 'userapp',
    password: 'password',
    database: 'forum_app'
});

// Establishing connection with the database
db.connect((err) => {
    if (err) throw err;
    console.log('Connected to the database');
});

app.get('/', (req, res) => {
    res.render('index', { user: req.session.user }); // Uses 'index.ejs' from the 'views' folder
});

app.post('/register', (req, res) => {
    const { username, password, confirm_password } = req.body;

    // Check if the passwords match
    if (password !== confirm_password) {
        return res.status(400).send('Passwords do not match.');
    }

    // Check if the user already exists
    const userExistsQuery = 'SELECT * FROM users WHERE username = ?';
    db.query(userExistsQuery, [username], (err, results) => {
        if (results.length > 0) {
            return res.status(400).send('User already exists.');
        } else {
            // Add user to the database
            const insertUserQuery = 'INSERT INTO users (username, password) VALUES (?, ?)';
            db.query(insertUserQuery, [username, password], (err, results) => {
                if (err) {
                    return res.status(500).send('Error during user registration.');
                }
                // After adding the user
                const userId = results.insertId; // ID of the newly created user
                const { bio, avatar_url } = req.body;

                const insertProfileQuery = 'INSERT INTO user_profiles (user_id, bio, avatar_url) VALUES (?, ?, ?)';
                db.query(insertProfileQuery, [userId, bio, avatar_url], (err, profileResults) => {
                    if (err) {
                        return res.status(500).send('Error while adding user profile.');
                    }
                    res.redirect('/');
                });
            });
        }
    });
});


app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = `SELECT * FROM users WHERE username = ? AND password = ?`;

    db.query(query, [username, password], (err, results) => {
        if (err) {
            res.status(500).send('Błąd serwera');
            return;
        }
        if (results.length > 0) {
            req.session.user = results[0]; // Save user details to the session
            res.redirect('/topics');
        } else {
            res.render('login-error');
        }
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            res.status(500).send('Cannot log out');
        } else {
            res.redirect('/');
        }
    });
});

// Route for displaying topics
app.get('/topics', (req, res) => {
    if (!req.session.user) {
        res.render('login-info');
    } else {
        const query = 'SELECT * FROM topics';
        db.query(query, (err, results) => {
            if (err) throw err;
            res.render('topics', { topics: results, user: req.session.user });
        });
    }
});

app.get('/add-topic', (req, res) => {
    res.render('add-topic', { user: req.session.user });
});

app.post('/topics', (req, res) => {
    const { name, description } = req.body;
    const query = 'INSERT INTO topics (name, description) VALUES (?, ?)';
    db.query(query, [name, description], (err, results) => {
        if (err) {
            res.status(500).send('An error occurred while adding the topic');
            return;
        }
        res.redirect('/topics');
    });
});

app.get('/topics/:id', (req, res) => {
    const topicId = req.params.id;
    const queryTopic = 'SELECT * FROM topics WHERE id = ?';

    db.query(queryTopic, [topicId], (err, topicResult) => {
        if (err || topicResult.length === 0) {
            res.status(500).send('An error occurred or the topic does not exist.');
            return;
        }

        const queryPosts = 'SELECT posts.*, users.username FROM posts JOIN users ON posts.user_id = users.id WHERE topic_id = ?';
        db.query(queryPosts, [topicId], (err, posts) => {
            if (err) {
                res.status(500).send('An error occurred while retrieving posts.');
                return;
            }

            // Retrieving replies for each post
            const repliesPromises = posts.map(post => new Promise((resolve, reject) => {
                const queryReplies = 'SELECT replies.*, users.username FROM replies JOIN users ON replies.user_id = users.id WHERE post_id = ?';
                db.query(queryReplies, [post.id], (err, replies) => {
                    if (err) reject(err);
                    post.replies = replies;
                    resolve();
                });
            }));

            Promise.all(repliesPromises)
                .then(() => res.render('topic-posts', { topic: topicResult[0], posts, user: req.session.user }))
                .catch(error => res.status(500).send('Error while retrieving replies.'));
        });
    });
});

app.get('/add-post/:topicId', (req, res) => {
    const topicId = req.params.topicId; // Retrieve topic ID from URL
    res.render('add-post', { topic_id: topicId, user: req.session.user }); // Pass topic ID to the view
});

app.post('/posts', (req, res) => {
    const { title, content, topic_id } = req.body;
    const userId = req.session.user.id; // Retrieve logged-in user's ID from session

    const query = 'INSERT INTO posts (title, content, topic_id, user_id) VALUES (?, ?, ?, ?)';
    db.query(query, [title, content, topic_id, userId], (err, result) => {
        if (err) {
            res.status(500).send('An error occurred while adding the post.');
            return;
        }
        res.redirect('/topics/' + topic_id); // Redirect to the topic page
    });
});

app.get('/delete-post/:topicId/:postId', (req, res) => {
    const { topicId, postId } = req.params;
    if (!req.session.user) {
        res.status(403).send("Access denied");
        return;
    }

    const deleteQuery = 'DELETE FROM posts WHERE id = ? AND user_id = ?';
    db.query(deleteQuery, [postId, req.session.user.id], (err, result) => {
        if (err) {
            res.status(500).send('An error occurred while deleting the post.');
            return;
        }
        res.redirect('/topics/' + topicId);
    });
});

app.post('/add-reply', (req, res) => {
    const { post_id, topic_id, content } = req.body;
    const user_id = req.session.user.id; // Assuming the user is logged in

    const query = 'INSERT INTO replies (post_id, user_id, content) VALUES (?, ?, ?)';
    db.query(query, [post_id, user_id, content], (err, result) => {
        if (err) {
            res.status(500).send('An error occurred while adding the reply.');
            return;
        }
        res.redirect('/topics/' + topic_id); // Redirect back to the post
    });
});

app.get('/users', (req, res) => {
    if (!req.session.user) {
        res.render('login-info');
    } else {
        const query = 'SELECT * FROM users';
        db.query(query, (err, results) => {
            if (err) {
                res.status(500).send('Server error while retrieving users');
                return;
            }
            res.render('users', { users: results, user: req.session.user });
        });
    }
});

app.get('/delete-reply/:replyId', (req, res) => {
    const replyId = req.params.replyId;

    if (!req.session.user) {
        res.status(403).send("Brak dostępu");
        return;
    }

    const deleteQuery = 'DELETE FROM replies WHERE id = ? AND user_id = ?';
    db.query(deleteQuery, [replyId, req.session.user.id], (err, result) => {
        if (err) {
            res.status(500).send('Wystąpił błąd podczas usuwania odpowiedzi.');
            return;
        }
        // Przekierowanie z powrotem do odpowiedniego postu/tematu
        res.redirect('back');
    });
});

app.get('/user-profile/:userId', (req, res) => {
    const userId = req.params.userId;

    const queryUser = 'SELECT * FROM users WHERE id = ?';
    const queryProfile = 'SELECT * FROM user_profiles WHERE user_id = ?';

    db.query(queryUser, [userId], (err, userResults) => {
        if (err || userResults.length === 0) {
            res.status(500).send('An error occurred or the user does not exist.');
            return;
        }

        db.query(queryProfile, [userId], (err, profileResults) => {
            if (err) {
                res.status(500).send('An error occurred while retrieving the user profile.');
                return;
            }

            const user = userResults[0];
            const profile = profileResults[0] || {};
            res.render('user-profile', { user: { ...user, ...profile } });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
