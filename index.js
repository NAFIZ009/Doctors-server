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



async function run(){
    const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
    const bookingsCollection = client.db('doctorsPortal').collection('bookings');




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
}

run().catch(console.log);


app.get('/', async (req, res) => {
    res.send('doctors portal server is running');
})

app.listen(port, () => console.log(`Doctors portal running on ${port}`))