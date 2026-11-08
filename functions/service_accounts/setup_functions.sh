#!/bin/bash

MAIN_ACCOUNT_KEY="service_accounts/serviceAccountKey.json"
MASTER_ACCOUNT_KEY="service_accounts/serv_account_key_master.json"
DEVELOP_ACCOUNT_KEY="service_accounts/serv_account_key_develop.json"
ACCOUNT_KEY_TO_USE=$DEVELOP_ACCOUNT_KEY

MAIN_FIREBASE_CONFIG="firebaseConfig.js"
MASTER_FIREBASE_CONFIG="firebaseConfig.master.js"
DEVELOP_FIREBASE_CONFIG="firebaseConfig.develop.js"
FIREBASE_CONFIG_TO_USE=$DEVELOP_FIREBASE_CONFIG

PROJECT_NAME_MASTER="alldonealeph"
PROJECT_NAME_DEVELOP="alldonestaging"

GIT_BRANCH="$(echo `git branch | grep '*' | cut -d' ' -f2`)"

if [[ -n $CI_COMMIT_REF_NAME ]]; then
  GIT_BRANCH=$CI_COMMIT_REF_NAME
fi

if [[ $GIT_BRANCH = "master" ]]; then
  AD_FIREBASE_PROJECT_NAME=$PROJECT_NAME_MASTER
  ACCOUNT_KEY_TO_USE=$MASTER_ACCOUNT_KEY
  FIREBASE_CONFIG_TO_USE=$MASTER_FIREBASE_CONFIG
else
  AD_FIREBASE_PROJECT_NAME=$PROJECT_NAME_DEVELOP
  ACCOUNT_KEY_TO_USE=$DEVELOP_ACCOUNT_KEY
  FIREBASE_CONFIG_TO_USE=$DEVELOP_FIREBASE_CONFIG
fi

echo $AD_FIREBASE_PROJECT_NAME > tmp_project_name

echo "-------------------------------------------------------------------------------------"
echo "Exported project name [${AD_FIREBASE_PROJECT_NAME}] into file [tmp_project_name]!"
echo "-------------------------------------------------------------------------------------"

if [[ -s $ACCOUNT_KEY_TO_USE ]]; then

  cp -R -f $ACCOUNT_KEY_TO_USE $MAIN_ACCOUNT_KEY
  echo "-------------------------------------------------------------------------------------"
  echo "Copied content of file [${ACCOUNT_KEY_TO_USE}] for branch [${GIT_BRANCH}] to main [${MAIN_ACCOUNT_KEY}] file!"
  echo "-------------------------------------------------------------------------------------"

else

  echo "-------------------------------------------------------------------------------------"
  echo "The file [${ACCOUNT_KEY_TO_USE}] for branch [${GIT_BRANCH}] do not exists or is empty!"
  echo "-------------------------------------------------------------------------------------"

fi

if [[ -s $FIREBASE_CONFIG_TO_USE ]]; then

  cp -R -f $FIREBASE_CONFIG_TO_USE $MAIN_FIREBASE_CONFIG
  echo "-------------------------------------------------------------------------------------"
  echo "Copied content of file [${FIREBASE_CONFIG_TO_USE}] for branch [${GIT_BRANCH}] to main [${MAIN_FIREBASE_CONFIG}] file!"
  echo "-------------------------------------------------------------------------------------"

else

  echo "-------------------------------------------------------------------------------------"
  echo "The file [${FIREBASE_CONFIG_TO_USE}] for branch [${GIT_BRANCH}] does not exist or is empty!"
  echo "-------------------------------------------------------------------------------------"

fi
