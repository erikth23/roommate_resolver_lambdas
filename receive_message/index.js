const AWS = requrie('aws-sdk')
const dynamoDBClient = =new AWS.dynamoDBClient({region: 'us-east-1'});

async function asyncForEach(array, callback) {
	for (let index = 0; index < array.length; index++) {
		await callback(array[index], index)
	}
}

const HELP = "HELP"
const FOR = "FOR"
const AGAINST = "AGAINST"

const receiveEnum = {
	DONE: markComplete,
	ADD: addTask,
	REMOVE: removeTask,
	VOTE: voteOnTask,
	DISPLAY: display
}

const taskStatus = {
	NOT_SCHEDULED: "not_scheduled",
	PENDING_COMPLETION: "pending_completion",
	PENDING_VOTE: "pending_vote",
	FAILED_VOTE: "failed_vote"
	COMPLETE: "complete"
}

exports.handler = async (event, context, cb) => {
	await asyncForEach(event.Records, async (record, i) => {
		const payload = record['Sns']
		const message = JSON.parse(payload["message"])
		const number = message['originationNumber'].substring(2);

		const messageSplit = message.split(" ").map(str => str.toLowerCase().trim());

		const first_word = messageSplit[0].toUpperCase()

		if (!receiveEnum.contains(first_word)) {
			displayHelp(error = True)
		} else if (first_word == HELP) {
			displayHelp()
		}

		const searchHouseParams = {
			TableName: "roommate_resolver",
			FilterExpression: "contains (phone_numbers, :roommate_number)",
			ExpressionAttributeValues: {
				":roommate_number": number
			}
		}

		await dynamoDBClient.scan(searchHouseParams).then((data) => {
			console.log(data.Items[0])
			//receiveEnum[first_word](messageSplit, data, number)
		}).catch((err) => {
			console.error(err)
			// send error message back to user
		});
	})
}


/* Marks a task complete and places it in pending */
async function markComplete(messageSplit, data, number) {
	const taskName = messageSplit[1]
	// check if task exists.  if not send message to user and return
	// mark task as PENDING_VOTE
	const user = data.phone_numbers[number]
	const taskIndex = data.tasks.findIndex(t => t.name == taskName);

	if (taskIndex == -1) {
		await sendMessage("This task does not exist :(", number)
	}

	if (!data[number].my_tasks.contains[taskIndex]) {
		await sendMessage("This was not your task :(.\n\nTo view tasks respond with 'DISPLAY my tasks'", number)
	}

	const task = data.tasks[taskIndex]
	task.status = taskStatus.PENDING_VOTE
	task.for = [
		...task.for,
		number
	]
	const updateTask = {
		TableName: "roommate_resolver",
		Item: data
	}

	await dynamoDBClient.put(updateTask).then(async (data) => {
		// construct message
		const message = `${task.name} was marked as done by ${data[number].name}.\n\n` +
		`VOTING:\nfor:${task.for.length}\nagainst:${task.against.length}\n` +
		`pending:${task.pending.length}`;

		// publish message to topic asking for votes
		await sendMessage(message, data.event_topic, all = true)
	}).catch(async err => {
		console.error(err)
		await sendMessage("Failed to update - ask Erik", number)
	})
}


/* Adds a new task to the list */
async function addTask(messageSplit, data, number) {
	const timeFrame = messageSplit[1]
	const taskName = messageSplit[2]

	// check if timeFrame exists. If not message user and return
	timeFrameIndex = data.time_frames.findIndex(t => t.name == timeFrame)

	if(timeFrameIndex == -1) {
		await sendMessage(`${timeFrame} is an invalid time frame:(`, number)
		return;
	}

	// check that task doesn't already exist. If it does then message user and return
	taskIndex = data.tasks.findIndex(t => t.name = taskName)

	if(taskIndex != -1) {
		await sendMessage(`${taskName} already exists`)
		return;
	}

	// add task
	data.tasks = [...data.tasks,
	{
		"name": taskName,
		"status": taskStatus.NOT_SCHEDULED,
		"for": [],
		"against": [],
		"pending": [],
		"time_frame": timeFrameIndex
	}]

	const addTask = {
		TableName: "roommate_resolver",
		Item: data
	}

	await dynamoDBClient.put(addTask).then(async data => {
		// message user and return list of tasks
		message = "Task successfully added\n";
		data.tasks.forEach((item, i) => {
			message += `\n${item.name}: ${data.time_frames[item.time_frame].name}`
		});

		await sendMessage(message, data.event_topic, all=true)
	}).catch(async err => {
		await sendMessage("Failed to update - ask Erik", number)
	})
}


/* Removes a task to the list */
async function removeTask(messageSplit, data, number) {
	const taskName = messageSplit[1]

	// check that task exists. If not then message user and return
	taskIndex = data.tasks.findIndex(t => t.name == taskName)

	if(taskIndex == -1) {
		await sendMessage(`${taskName} does not exist, so no need to remove :)`, number)
		return;
	}

	// remove task
	data.tasks.splice(taskIndex, 1)

	const removeTask = {
		TableName: "roommate_resolver",
		Item: data
	}

	await dynamoDBClient.put(removeTask).then(async data => {
		message = "Task successfully removed\n";
		data.tasks.forEach((item, i) => {
			message += `\n${item.name}: ${data.time_frames[item.time_frame].name}`
		});

		await sendMessage(message, data.event_topic, all=true)
	}).catch(async err => {
		await sendMessage("Failed to update - ask Erik", number)
	})
}


async function voteOnTask(messageSplit, data, number) {
	const vote = messageSplit[1].toUpperCase()
	const taskName = messageSplit[2]

	// check that task exists. If not then message user and return
	const taskIndex = data.tasks.find(t => t.name == taskName)

	if(taskIndex == -1) {
		await sendMessage(`${taskName} does not exist`)
		return;
	}

	const task = data.tasks[taskIndex]

	// add phone number to corresponding vote array
	if(vote == FOR) {
		task.for = [
			...task.for,
			number
		]
	} else if(vote == AGAINST) {
		task.against = [
			...task.against,
			number
		]
	} else {
		await sendMessage(`Failed to add vote to ${taskName}`, number)
		return;
	}

	const voteTask = {
		TableName: "roommate_resolver",
		Item: data
	}

	message = ""

	// construct message
	if(task.for.length / data.phone_numbers.length > 0.5) {
		task.status = COMPLETE
		message = `Congrats! ${task.name}'s completion has been agreed on'`
	} else if (task.against.length / data.phone_numbers > 0.5) {
		task.status = FAILED_VOTE
		message = `CHALLENGED! ${task.name} has been challenged! The majority of the house believes this task was not completed :(`
	} else {
		message = `${data.phone_numbers[number].name} voted ${vote} ${taskName}`
	}

	dynamoDBClient.put(voteTask).then(data => {
		await sendMessage(message, data.house_id, all=true)
	}).catch(err => {
		console.error(err)
		sendMessage("Failed to vote on task - ask Erik", number)
	})

	// publish message to topic
}

async function display(messageSplit, data, number) {
	// construct message

	// send message to user
}

async function sendMessage(message, number, all = false) {}
