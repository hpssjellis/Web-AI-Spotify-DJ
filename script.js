/********************************************************************* 
 * Spotify Web AI DJ designed and coded by Jason Mayes 2025. 
 *--------------------------------------------------------------------
 * Connect with me on social if aquestions or comments:
 *
 * LinkedIn: https://www.linkedin.com/in/webai/
 * Twitter / X: https://x.com/jason_mayes
 * Github: https://github.com/jasonmayes
 * CodePen: https://codepen.io/jasonmayes
 *********************************************************************/

import {KokoroTTS} from "https://cdn.jsdelivr.net/npm/kokoro-js@1.0.0/dist/kokoro.web.js";
import {FilesetResolver, LlmInference} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import spotifyAPIHelper from '/spotifyLib.js';
import fetchInChunks from '/fetchInChunks.js';
import MD5 from '/fetchInChunks.js';


/**************************************************************
 * DOM References and defaults
 **************************************************************/
const SIDE_PANEL_LLM_WRITE_SPACE = document.getElementById('sidePanelInterface');
const PRELOADER = document.getElementById('preloader');
const PROGRESS = document.getElementById('progress');
const CHAT = document.getElementById('chat');
const SEARCH_RESULTS_AREA = document.getElementById('searchResults');
const HCI_PERSONA_TEXTBOX = document.getElementById('hciPersona');
const CHAT_BTN = document.getElementById('chatBtn');
const ERASE_MEMORY_BTN = document.getElementById('eraseMemorytBtn');
const TALK_TO_AGENT_BTN = document.getElementById('talkToAgent');
const AUDIO_GENERATOR = document.getElementById('player');
AUDIO_GENERATOR.addEventListener('ended', (event) => {
  audioCompleteCallback();
});



async function cacheIt(blob, fileUrl) {
  try {
    const MODEL_CACHE = await caches.open('models');
    await MODEL_CACHE.put(MD5(fileUrl), new Response(blob));
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error(err.name, err.message);
    return URL.createObjectURL(blob);
  }
}


async function fetchAndCacheFile(url, backupUrl) {
  console.log('Fetch and caching: ' + url);
  let blob = undefined;
  try {
    blob = await fetchInChunks(url, {
      chunkSize: 5 * 1024 * 1024,
      maxParallelRequests: 10,
      progressCallback: (done, total) => (PROGRESS.innerText = 'Loading 2.5GB Agent Web AI Model file: ' + Math.round((done / total) * 100) + '%')
    });
    PROGRESS.innerText = 'Model downloaded. Intializing on GPU... Please wait.';
    return cacheIt(blob, url);
  } catch(e) {
    // Try backup URL instead.
    if(backupUrl) {
      return fetchAndCacheFile(backupUrl);
    }
  }
};


async function fetchFile(url, backupUrl) {
  console.log('Attempting to fetch: ' + url);
  try {
    const MODEL_CACHE = await caches.open('models');
    const response = await MODEL_CACHE.match(MD5(url));
    if (!response) {
      console.warn('Requested file not in cache - fetching and caching.')
      return await fetchAndCacheFile(url, backupUrl);
    } else {
      const file = await response.blob();
      return await URL.createObjectURL(file);
    }
  } catch (err) {
    console.error(err);
  }
};



/**************************************************************
 * TTS Engine: Uses Kokoro or Browser Web Standards.
 **************************************************************/
const USE_BROWSER_TTS = true;
const AUDIO_MODEL_ID = "onnx-community/Kokoro-82M-ONNX";

let tts = undefined;
let ttsCallback = undefined;

async function loadKokoro() {
  tts = await KokoroTTS.from_pretrained(AUDIO_MODEL_ID, {
    dtype: "fp16", // Options: "fp32", "fp16", "q8", "q4", "q4f16"
  });
}


if(USE_BROWSER_TTS) {
  loadKokoro();
}


async function speakText(text, callback) {
  console.log('Attempting to speak: ' + text);
  ttsCallback = callback;
  if (USE_BROWSER_TTS) {
    let utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
    audioCompleteCallback();
  } else {
    const AUDIO = await tts.generate(text, {
      // Use `tts.list_voices()` to list all available voices
      voice: "bm_george",
    });
    AUDIO_GENERATOR.src = await URL.createObjectURL(AUDIO.toBlob());
    AUDIO_GENERATOR.load();
  }
}


function audioCompleteCallback() {
  if(ttsCallback) {
    ttsCallback();
  }
}



/**************************************************************
 * Spotify Player control / API code.
 **************************************************************/
// Initialize the Spotify API Helper library.
spotifyAPIHelper.init('devices');

let spotController = undefined;
let generatedList = undefined;
let playlistIndex = 0;
let backoff = 2000;
let notJustLoaded = true;
let lastPlaybackUpdate = 0;

let authBtn = document.getElementById('authBtn');
authBtn.addEventListener('click', function() {
  spotifyAPIHelper.requestAuth(document.getElementById('clientId').value, document.getElementById('clientSecret').value);
});


// Inject the Spotify iframe player to the page once the API is ready to go.
window.onSpotifyIframeApiReady = (IFrameAPI) => {
  const element = document.getElementById('embed-iframe');
  // Set a default playlist to render before user interaction.
  const options = {
      uri: 'spotify:playlist:4j4GF3Ka6QsGqnjL17ju3k'
    };

  IFrameAPI.createController(element, options, spotifyCallback);
};


// Custom playback event monitor to detect if Spotify (or user) paused the song.
function monitorPlayback() {
  lastPlaybackUpdate++;
  setTimeout(monitorPlayback, 250);
}
monitorPlayback();


// Spotify player created. Add event listeners and logic to detect if paused.
function spotifyCallback(EmbedController) {
  spotController = EmbedController;
  spotController.addListener('playback_update', e => {
    lastPlaybackUpdate = 0;
    setTimeout(function() {
      if (lastPlaybackUpdate > 4 && notJustLoaded) {
        // Song ended or was paused by spotify auto play next.
        if (playlistIndex < generatedList.artists.length) {
          notJustLoaded = false;
          // Announce the song.
          speakText(generatedList.artists[playlistIndex].justification);
          // Play the next song.
          playArtist(generatedList.artists[playlistIndex].artist);
          // Debounce Spotify issue that generates multiple callbacks in succession in short time.
          setTimeout(function(){notJustLoaded = true;}, backoff);
        }
      }
    }, 1500);
  });
}


function playArtist(artistName) {
  playlistIndex++;
  spotifyAPIHelper.callAPI('GET', 'https://api.spotify.com/v1/search?q='+ artistName + '&type=artist', null, function(data) {
    if ( this.status == 200 ) {
      var data = JSON.parse(this.responseText);
      console.log(data);
      spotifyAPIHelper.callAPI('GET', 'https://api.spotify.com/v1/artists/' + data.artists.items[0].id + '/top-tracks', null, function(data) {
        if ( this.status == 200 ) {
          var data = JSON.parse(this.responseText);
          console.log(data);
          spotController.loadUri(data.tracks[0].uri);
          spotController.play();
        }
      });
    }
    else if ( this.status == 401 ){
      spotifyAPIHelper.refreshAuth();
    }
    else {
      console.log(this.responseText);
    }    
  });
}



/**************************************************************
 * Web AI Gemma 2 LLM code.
 **************************************************************/
const modelFileNameRemote = 'https://storage.googleapis.com/jmstore/WebAIDemos/models/Gemma2/gemma2-2b-it-gpu-int8.bin';
const modelFileName = 'http://localhost/gemma2-2b-it-gpu-int8.bin';

const CHAT_PERSONA_NAME = 'chatPersona';
const CHAT_PERSONA_HISTORY = [];

let llmInference = undefined;
let lastGeneratedResponse = '';
let activePersona = '';

async function initLLM(modelUrl) {
  let dataUrl = await fetchFile(modelFileName, modelFileNameRemote);
  const genaiFileset = await FilesetResolver.forGenAiTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');
  
  let llm = await LlmInference.createFromOptions(genaiFileset, {
    baseOptions: {
      modelAssetPath: dataUrl
    },
    maxTokens: 8000,
    topK: 1,
    temperature: 0.01, // More deterministic and focused.
    randomSeed: 64
  });
  //.createFromModelPath(genaiFileset, modelFileName)

  llmInference = llm;
  PRELOADER.classList.remove('animate__fadeIn');
  PRELOADER.classList.add('animate__fadeOut');
  setTimeout(function() {
    PRELOADER.setAttribute('class', 'removed');
  }, 1000);

}


function executeAgent(task, personaName, personaHistory) {
  // Only proceed with execution if no active generation in progress.
  if (lastGeneratedResponse === '') {
    activePersona = personaName;
    personaHistory.push('<start_of_turn>user\n' + task + '<end_of_turn>\n<start_of_turn>model\n');

    if(llmInference !== undefined) {
      llmInference.generateResponse(personaHistory.join(''), displayPartialAgentResults);
    }

    SEARCH_RESULTS_AREA.innerHTML = '<h2>Analysing user input</h2><p>This may take a moment.</p>';

    SEARCH_RESULTS_AREA.setAttribute('class', 'preSearch');
  } else {
    console.warn('Can not process request as agent busy!');
  }
}



// Kick off LLM load right away.
initLLM();



/**************************************************************
 * Other Web app business logic - the typical code the web app would
 * have used without any Agents to get stuff done 
***************************************************************/

// Call the agent from our app logic to execute user demand.
CHAT_BTN.addEventListener('click', function() {
  SIDE_PANEL_LLM_WRITE_SPACE.innerText = '';
  executeAgent(CHAT.value, CHAT_PERSONA_NAME, CHAT_PERSONA_HISTORY);
  CHAT.value = '';
});

window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SPEECH_RECOGNITION = new window.SpeechRecognition();
SPEECH_RECOGNITION.continuous = true;
SPEECH_RECOGNITION.interimResults = true;
SPEECH_RECOGNITION.addEventListener("result", function(data) {
 for (const result of data.results) {
   if (result.isFinal) {
     console.log(result[0].transcript);
     executeAgent(result[0].transcript, CHAT_PERSONA_NAME, CHAT_PERSONA_HISTORY);
   }
 }
});

function speechDeactivated () {
  TALK_TO_AGENT_BTN.setAttribute('class', '');
  // Allow 1s grace for speech recognition to finish.
  setTimeout(function(){
    SPEECH_RECOGNITION.stop();
  },1000);
}

TALK_TO_AGENT_BTN.addEventListener('mousedown', function() {
  this.setAttribute('class', 'activated');
  try {
    SPEECH_RECOGNITION.start();
  } catch(e) {
    console.log(e);
  }
});
TALK_TO_AGENT_BTN.addEventListener('mouseup', speechDeactivated);
TALK_TO_AGENT_BTN.addEventListener('focusout', speechDeactivated);

// As this is a demo we also allow the clearning of agent memory to start fresh.
ERASE_MEMORY_BTN.addEventListener('click', function() {
  CHAT_PERSONA_HISTORY.splice(0);
  CHAT_PERSONA_HISTORY.push(agentPersonas[CHAT_PERSONA_NAME]);
  SIDE_PANEL_LLM_WRITE_SPACE.innerText = '';
});


// Handle rendering of results sent back from LLM.
function displayPartialAgentResults(partialResults, complete) {
  lastGeneratedResponse += partialResults;
  SIDE_PANEL_LLM_WRITE_SPACE.innerText = lastGeneratedResponse;
  
  if (complete) {
    if (!lastGeneratedResponse) {
      console.error('Result is empty');
    }
    
    // Decide which chat history to work with.
    let chatHistory;
    if (activePersona === CHAT_PERSONA_NAME) {
      chatHistory = CHAT_PERSONA_HISTORY;
    }
    
    // Concat with open model turn to complete history correctly.
    chatHistory[chatHistory.length - 1] += lastGeneratedResponse + '<end_of_turn>\n';
    
    // Ensure we dont max out our tokens in a long chatty user session.
    if (chatHistory.length > 7) {
      // remove the 2nd chat from the start so not to remove
      // the persona def.
      chatHistory.splice(1, 1);
    }
    console.log(activePersona + " " + chatHistory.length);


    let answerObj = undefined;
    
    try {
      answerObj = JSON.parse(lastGeneratedResponse.split('```json')[1].split('```')[0]);
      console.log(answerObj);
      generatedList = answerObj;
      playlistIndex = 0;
      speakText(generatedList.introduction, function() {
        console.log('called');
        speakText(generatedList.artists[0].justification);
      });

      playArtist(generatedList.artists[playlistIndex].artist);
      displaySearchResults(generatedList);
    } catch(e) {
      // LLM fail at valid JSON response. 
      // Potentially try and pass manually or follow up 
      //asking it to fix broken JSON it returned.
      console.warn('Invalid JSON generated');
      // For now we just log bad JSON for debugging.
      console.log(answerObj);
    }

    lastGeneratedResponse = '';
  }
}


// Web Dev designs a suitable Agent persona to work with 
// the exposed functions below.
function setupAgentPersonas() {
  // In this demo we set defaults in the HTML itself so 
  // you can play around later. Also append current date for smarts.
  let personas = {
    [CHAT_PERSONA_NAME]: HCI_PERSONA_TEXTBOX.value
  };
  
  return personas;
}


function agentPersonaChange() {
  agentPersonas = setupAgentPersonas();
  // Overwrite persona in current persona chat histories too.
  CHAT_PERSONA_HISTORY[0] = agentPersonas[CHAT_PERSONA_NAME];
  SIDE_PANEL_LLM_WRITE_SPACE.innerText = '';
}


let agentPersonas = setupAgentPersonas();
HCI_PERSONA_TEXTBOX.addEventListener('keyup', agentPersonaChange);
CHAT_PERSONA_HISTORY.push(agentPersonas[CHAT_PERSONA_NAME]);


/** 
 *  Web App Agent Functions it can call. 
 *
 *  This is a develeoper decision what to expose so 
 *  they always stay in control of what functions to
 *  expose to agent. This also means they can control
 *  the UX when an agent does something vs a human eg
 *  perform actions faster but could still educate user
 *  watching on how GUI is used to learn from the agent
 * behaviour.
 **/

function displaySearchResults(data) { 
  SEARCH_RESULTS_AREA.innerHTML = '';

  const TABLE = document.createElement('table');
  
  for (let n = 0; n < data.artists.length; n++) {
    const TR = document.createElement('tr');
    
    const TD_ARTIST = document.createElement('td');
    TD_ARTIST.innerText = data.artists[n].artist;
    TD_ARTIST.setAttribute('class', 'artistName');
    TR.appendChild(TD_ARTIST);
    
    const TD_JUSTIFICATION = document.createElement('td');
    TD_JUSTIFICATION.innerText = data.artists[n].justification;
    TD_JUSTIFICATION.setAttribute('class', 'artistJustification');
    TR.appendChild(TD_JUSTIFICATION);
    
    
    TABLE.appendChild(TR);
  }
  SEARCH_RESULTS_AREA.setAttribute('class', 'searchComplete');
  SEARCH_RESULTS_AREA.appendChild(TABLE);
}
