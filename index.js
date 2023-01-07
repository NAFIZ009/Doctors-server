const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5002;

const app = express();

// middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.9grhubl.mongodb.net/?retryWrites=true&w=majority`;
// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.twtll.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

var admin = require("firebase-admin");

var serviceAccount = require("./doctors-portal-ada67-firebase-adminsdk-wdtqe-61b5bcb27d.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

//verify JWT
function verifyJWT(req, res, next) {
    
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access');
    }
    
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            console.log(err);
            return res.status(403).send({ message: 'forbidden access' })
        }
        req.decoded = decoded;
        next();
    })

}

async function run(){
    const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingsCollection = client.db('doctorsPortal').collection('bookings');
    const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');

        //admin verification
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                console.log("bruh")
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }


    //getting appointment dates
    app.get('/appointmentOptions', async (req, res) => {
        const date = req.query.date;
        const query = {};
        const options = await appointmentOptionCollection.find(query).toArray();

        // get the bookings of the provided date
        const bookingQuery = { appointmentDate: date }
        const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

        // code carefully :D
        options.forEach(option => {
            const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
            const bookedSlots = optionBooked.map(book => book.slot);
            const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
            option.slots = remainingSlots;
        })
        res.send(options);
    });

    app.get('/appointmentSpecialty', async (req, res) => {
        const query = {}
        const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
        res.send(result);
    });

    //getting all the bookings for a user
    app.get('/bookings', verifyJWT, async (req, res) => {
        const email = req.query.email;
        const decodedEmail = req.decoded.email;

        if (email !== decodedEmail) {
            return res.status(403).send({ message: 'forbidden access' });
        }

        const query = { email: email };
        const bookings = await bookingsCollection.find(query).toArray();
        res.send(bookings);
    });

    //specific booking 
    app.get('/bookings/:id', async (req, res) => {
        const id = req.params.id;
        const query = { _id: ObjectId(id) };
        const booking = await bookingsCollection.findOne(query);
        res.send(booking);
    });

    //posting booking
    app.post('/bookings', async (req, res) => {
        const booking = req.body;
        console.log(booking); 
        const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
            treatment: booking.treatment
        }

        const alreadyBooked = await bookingsCollection.find(query).toArray();

        if (alreadyBooked.length) {
            const message = `You already have a booking on ${booking.appointmentDate}`
            return res.send({ acknowledged: false, message })
        }

        const result = await bookingsCollection.insertOne(booking);
        // send email about appointment confirmation 
        // sendBookingEmail(booking)
        res.send(result);
    });

    //jwt token
    app.get('/jwt', async (req, res) => {
        const email = req.query.email;
        const query = { email: email };
        const user = await usersCollection.findOne(query);
        if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN)
            return res.send({ accessToken: token });
        }
        res.status(403).send({ accessToken: '' })
    });

    //payments
    app.post('/create-payment-intent', async (req, res) => {
        const booking = req.body;
        const price = booking.price;
        const amount = price * 100;

        const paymentIntent = await stripe.paymentIntents.create({
            currency: 'usd',
            amount: amount,
            "payment_method_types": [
                "card"
            ]
        });
        res.send({
            clientSecret: paymentIntent.client_secret,
        });
    });

    //payments
    app.post('/payments', async (req, res) => {
        const payment = req.body;
        const result = await paymentsCollection.insertOne(payment);
        const id = payment.bookingId
        const filter = { _id: ObjectId(id) }
        const updatedDoc = {
            $set: {
                paid: true,
                transactionId: payment.transactionId
            }
        }
    const updatedResult = await bookingsCollection.updateOne(filter,            updatedDoc)
        res.send(result);
    })

    //getting all the users
    app.get('/users', async (req, res) => {
        const query = {};
        const users = await usersCollection.find(query).toArray();
        res.send(users);
    });

    //getting if the user is admin
    app.get('/users/admin/:email', async (req, res) => {
        const email = req.params.email;
        const query = { email }
        const user = await usersCollection.findOne(query);
        res.send({ isAdmin: user?.role === 'admin' });
    })

    //posting users
    app.post('/users', async (req, res) => {
        const user = req.body;
        console.log(user);
        // TODO: make sure you do not enter duplicate user email
        // only insert users if the user doesn't exist in the database
        const result = await usersCollection.insertOne(user);
        res.send(result);
    });

    
    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const filter = { _id: ObjectId(id) }
        const options = { upsert: true };
        const updatedDoc = {
            $set: {
                role: 'admin'
            }
        }
        const result = await usersCollection.updateOne(filter, updatedDoc, options);
        res.send(result);
    });

    //
    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
        const query = {};
        const doctors = await doctorsCollection.find(query).toArray();
        res.send(doctors);
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
        const doctor = req.body;
        const result = await doctorsCollection.insertOne(doctor);
        res.send(result);
    });

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
        const id = req.params.id;
        const filter = { _id: ObjectId(id) };
        const result = await doctorsCollection.deleteOne(filter);
        res.send(result);
    });

    app.delete('/admin/user/delete',verifyJWT,verifyAdmin,async(req,res)=>{
        const uid=req.body.uid;
        const filter = { uid:uid };
        admin.auth().deleteUser(uid)
        .then(async()=>{
            res.send({success:true});
            const result=await usersCollection.deleteOne(filter);
            if(result.acknowledged){
                return res.send({success:true});
            }
            return res.send({success:false});
        })
        .catch(err=>{
            console.log(err);
            return res.send({success:false});
        })
    })
}

run().catch(console.log);


app.get('/', async (req, res) => {
    res.send('doctors portal server is running');
})

app.listen(port, () => console.log(`Doctors portal running on ${port}`))