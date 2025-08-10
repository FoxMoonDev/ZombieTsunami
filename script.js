const player = document.getElementById('player');
const gameBoard = document.getElementById('game-board');
const gameOverScreen = document.getElementById('game-over-screen');
const scoreDisplay = document.getElementById('score');

let isJumping = false;
let isGameOver = false;
let score = 0;
let obstacleInterval;
let scoreInterval;

// Função de Pulo
function jump() {
    if (isJumping || isGameOver) return;
    isJumping = true;
    player.classList.add('player-jump');
    setTimeout(() => {
        player.classList.remove('player-jump');
        isJumping = false;
    }, 600); // Duração da animação de pulo
}

// Ouvir o evento de pulo (barra de espaço)
document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
        jump();
    }
});

// Função para criar obstáculos
function createObstacle() {
    if (isGameOver) return;
    const obstacle = document.createElement('div');
    obstacle.classList.add('obstacle');
    gameBoard.appendChild(obstacle);

    // Remove o obstáculo depois que ele sai da tela para não sobrecarregar
    setTimeout(() => {
        if (!isGameOver) {
            obstacle.remove();
        }
    }, 3000); // Duração da animação do obstáculo
}

// Função de Game Over
function gameOver() {
    isGameOver = true;
    clearInterval(obstacleInterval); // Para de criar obstáculos
    clearInterval(scoreInterval); // Para de contar pontos
    
    // Para a animação de todos os obstáculos na tela
    const allObstacles = document.querySelectorAll('.obstacle');
    allObstacles.forEach(obs => obs.style.animationPlayState = 'paused');

    scoreDisplay.textContent = score;
    gameOverScreen.style.display = 'flex';
}

// Loop principal do jogo para verificar colisões
function checkCollision() {
    const playerRect = player.getBoundingClientRect();

    const obstacles = document.querySelectorAll('.obstacle');
    obstacles.forEach(obstacle => {
        const obstacleRect = obstacle.getBoundingClientRect();

        // Lógica de colisão simples
        if (
            playerRect.left < obstacleRect.right &&
            playerRect.right > obstacleRect.left &&
            playerRect.top < obstacleRect.bottom &&
            playerRect.bottom > obstacleRect.top
        ) {
            gameOver();
        }
    });

    if (!isGameOver) {
        requestAnimationFrame(checkCollision);
    }
}

// Inicia o jogo
function startGame() {
    // Cria obstáculos em intervalos aleatórios
    function scheduleNextObstacle() {
        if (isGameOver) return;
        const randomTime = Math.random() * 2000 + 1000; // Entre 1 e 3 segundos
        obstacleInterval = setTimeout(() => {
            createObstacle();
            scheduleNextObstacle();
        }, randomTime);
    }
    
    // Inicia a contagem de pontos
    scoreInterval = setInterval(() => {
        if(!isGameOver) {
            score++;
        }
    }, 100);

    scheduleNextObstacle();
    checkCollision();
}

startGame();