clean ::
	docker image rm covid-19-brief

lint ::
	docker run --rm -i \
		-v ${PWD}/.hadolint.yaml:/bin/hadolint.yaml \
		-e XDG_CONFIG_HOME=/bin hadolint/hadolint \
		< Dockerfile

build ::
	docker build -t covid-19-brief .

run ::
	docker run --rm -it --name covid-19-brief -e PORT=5000 -p 5000:5000 \
		covid-19-brief

tag ::
	docker tag covid-19-brief prantlf/covid-19-brief:latest

login ::
	docker login --username=prantlf

push ::
	docker push prantlf/covid-19-brief:latest

heroku ::
	heroku container:login
	heroku container:push web
	heroku container:release web
