
from flask import Flask, render_template
app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")  # тут буде твоя гра (HTML)

# локальний запуск не обов'язковий для Render, але нехай буде
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
