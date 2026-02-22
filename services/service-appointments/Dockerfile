FROM golang:1.22-alpine AS build
WORKDIR /src

COPY go.mod ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/service ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/service /service
EXPOSE 8080
ENTRYPOINT ["/service"]